/**
 * Request validation for the appointment book (API §5).
 *
 * ## Reasons are required where the contract says P4, and only there
 *
 * `reject`, `cancel`, `reschedule` and `cancel-administratively` all
 * carry a mandatory, non-empty `reason`: the schema's `.min(1)` after a
 * `.trim()` is what makes `"   "` a 422 rather than a cancellation with
 * a blank justification. `approve`, `complete` and `no-show` take no
 * body at all — a confirmation dialog with nothing to confirm is not a
 * P4 action, and demanding a reason for one trains people to type ".".
 *
 * ## Dates arrive as ISO-8601 strings and leave as `Date`
 *
 * `z.coerce.date()` accepts what `JSON.stringify(new Date())` produces
 * and rejects `"tomorrow"`. The `.refine` that a slot is in the future
 * is deliberately **absent** from creation: a receptionist entering
 * yesterday's walk-in is a legitimate back-fill, and ADR-001's rules
 * about what may then happen to it are enforced by the status machine
 * rather than by refusing the row.
 */

import { z } from 'zod';

import { APPOINTMENT_STATUS_VALUES } from './appointment-enums';

const PRIORITY_VALUES = ['low', 'normal', 'high', 'urgent'] as const;

/** `?status=` accepts one value or several — Express parses both shapes. */
const statusFilter = z
  .union([z.enum(APPOINTMENT_STATUS_VALUES), z.array(z.enum(APPOINTMENT_STATUS_VALUES))])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .optional();

const priorityFilter = z
  .union([z.enum(PRIORITY_VALUES), z.array(z.enum(PRIORITY_VALUES))])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .optional();

/**
 * A free-text reason. Trimmed first so whitespace cannot satisfy the
 * minimum, and capped at the column width so a 400-character reason
 * fails validation with a field error instead of a database error.
 */
const reason = z.string().trim().min(1).max(300);

/**
 * API §5.1 — the book.
 *
 * `view` selects the shape of the window rather than the shape of the
 * response: `day`, `week` and `month` are anchored on `date` and return
 * the whole window unpaginated, because a calendar draws every cell it
 * has and a page-2 link on a week view means nothing. `list` paginates.
 */
export const appointmentListSchema = z
  .object({
    view: z.enum(['list', 'day', 'week', 'month']).default('list'),
    /** The anchor for a calendar view. Defaults to the server's today. */
    date: z.coerce.date().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    status: statusFilter,
    priority: priorityFilter,
    visitType: z.string().trim().min(1).max(40).optional(),
    department: z.string().trim().min(1).max(80).optional(),
    /** Matches the patient's name, `PT-…` handle or MRN. */
    q: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['startsAt:asc', 'startsAt:desc']).default('startsAt:asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export type AppointmentListQuery = z.infer<typeof appointmentListSchema>;

/**
 * API §5.3 — create.
 *
 * `durationMin` has no default: ADR-005 §2 puts the doctor's
 * `default_duration_min` on the `doctors` row, and a default chosen here
 * would silently override the one the doctor configured. The service
 * reads theirs when the field is absent.
 */
export const createAppointmentSchema = z.object({
  /** `patients.public_id`. The service resolves and care-scopes it. */
  patientId: z.string().trim().min(1).max(20),
  dateTime: z.coerce.date(),
  durationMin: z.coerce.number().int().min(5).max(480).optional(),
  /** `visit_types.name`, e.g. `Consultation`. */
  visitType: z.string().trim().min(1).max(40),
  /** `departments.name`. Optional — the appointment's FK is nullable. */
  department: z.string().trim().min(1).max(80).optional(),
  priority: z.enum(PRIORITY_VALUES).default('normal'),
  reason,
  notes: z.string().trim().max(2000).optional(),
  isNewPatient: z.boolean().default(false),
  isFollowUp: z.boolean().default(false),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * API §5.5 — reject.
 *
 * `reasonCategory` is a closed set and `reason` is free text. The
 * category is what makes rejections reviewable in aggregate; the text is
 * what makes one of them defensible. The contract's example sends both,
 * and marks only the text optional.
 */
export const REJECT_CATEGORIES = [
  'schedule_conflict',
  'outside_specialty',
  'insufficient_information',
  'patient_unreachable',
  'other',
] as const;

export const rejectAppointmentSchema = z.object({
  reasonCategory: z.enum(REJECT_CATEGORIES),
  reason: reason.optional(),
});

export type RejectAppointmentInput = z.infer<typeof rejectAppointmentSchema>;

/** API §5.7 — cancel. P4: the reason is not optional. */
export const cancelAppointmentSchema = z.object({ reason });

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

/** API §5.6 — reschedule to a new slot, with a reason. */
export const rescheduleAppointmentSchema = z.object({
  dateTime: z.coerce.date(),
  durationMin: z.coerce.number().int().min(5).max(480).optional(),
  reason,
});

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

/**
 * API §5.8 — up to three alternative slots.
 *
 * Three columns in DB §S3, so three here: the maximum is the schema's,
 * not a policy this file invents. At least one, because a proposal with
 * no slots is not a proposal.
 */
export const proposeSlotsSchema = z.object({
  slots: z.array(z.coerce.date()).min(1).max(3),
  reason: reason.optional(),
});

export type ProposeSlotsInput = z.infer<typeof proposeSlotsSchema>;

/**
 * API §5.9 — resolve a time-off block's impact.
 *
 * `confirmedCount` is the blast-radius confirmation of ADR-005 §7: the
 * client echoes the number of appointments it showed the doctor, and a
 * mismatch against the server's current count is a 409 that sends
 * nothing. It is what stops a confirmation screen rendered five minutes
 * ago from acting on a list that has since grown.
 */
export const RESOLUTION_ACTIONS = ['reschedule-proposal', 'handover', 'cancel-apology'] as const;

export const resolveTimeOffSchema = z.object({
  action: z.enum(RESOLUTION_ACTIONS),
  confirmedCount: z.coerce.number().int().min(0),
  /** Empty means "every impacted appointment"; a list means those only. */
  appointmentIds: z.array(z.string().trim().min(1).max(20)).max(200).optional(),
  reason: reason.optional(),
});

export type ResolveTimeOffInput = z.infer<typeof resolveTimeOffSchema>;

/** API §5.10 — the oversight table's own filters. */
export const OVERSIGHT_FLAGS = ['stuck-pending', 'repeated-reschedules', 'complaint'] as const;

export const oversightListSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    status: statusFilter,
    doctorId: z.string().trim().min(1).max(64).optional(),
    department: z.string().trim().min(1).max(80).optional(),
    flag: z.enum(OVERSIGHT_FLAGS).optional(),
    /**
     * Matches the reference, the doctor and the department — never the
     * patient's name or MRN. A search box that resolved masked
     * identifiers would hand back exactly what the mask withholds.
     */
    q: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['startsAt:asc', 'startsAt:desc', 'stateSince:asc']).default('startsAt:asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export type OversightListQuery = z.infer<typeof oversightListSchema>;

/** API §5.10 — nudge. The template is closed; the note is free text. */
export const NUDGE_TEMPLATES = ['awaiting-confirmation', 'stalled-request', 'custom'] as const;

export const nudgeSchema = z.object({
  template: z.enum(NUDGE_TEMPLATES).default('awaiting-confirmation'),
  note: z.string().trim().max(300).optional(),
});

export type NudgeInput = z.infer<typeof nudgeSchema>;

/** API §5.10 — reassign to another doctor of the same specialty. */
export const reassignSchema = z.object({
  /** `doctors.id`. */
  doctorId: z.string().trim().min(1).max(64),
  reason,
});

export type ReassignInput = z.infer<typeof reassignSchema>;

/**
 * API §5.10 — administrative cancellation.
 *
 * The category mirrors the frontend's `CancelCategory` exactly: a closed
 * set is what makes these reviewable in aggregate, and the free text is
 * what makes one of them defensible.
 */
export const ADMIN_CANCEL_CATEGORIES = [
  'doctor-unavailable',
  'clinic-closure',
  'duplicate-booking',
  'policy-breach',
  'patient-safety',
] as const;

export const administrativeCancelSchema = z.object({
  category: z.enum(ADMIN_CANCEL_CATEGORIES),
  reason,
});

export type AdministrativeCancelInput = z.infer<typeof administrativeCancelSchema>;
