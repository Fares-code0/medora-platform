/**
 * Request validation for prescribing (API §7.5–§7.9).
 *
 * The bounds are the database's, restated so a violation is a 422 naming
 * the field rather than a CHECK constraint error the client cannot read:
 * `quantity > 0`, `duration_days > 0`, `refills_allowed >= 0` (DB §9).
 * Where the two could drift, the constraint is the backstop and this is
 * the message.
 */

import { z } from 'zod';

import {
  PRESCRIPTION_STATUS_VALUES,
  REFILL_STATUS_VALUES,
  WARNING_SEVERITY_VALUES,
} from './pharmacy-enums';

/** `PT-…`, `RX-…` — short public handles, never uuids on the wire. */
const handle = z.string().trim().min(1).max(20);

/** One value or several — Express parses a repeated key into an array. */
function multi(values: [string, ...string[]]) {
  return z
    .union([z.enum(values), z.array(z.enum(values))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional();
}

const uuid = z.string().trim().uuid();

/** P4 reasons are shown to colleagues; 300 is the column's width. */
const reason = z.string().trim().min(1).max(300);

/**
 * API §7.5 — the safety screen.
 *
 * `dosage` and `currentStep` are in the contract's body but are not read
 * by the screen: the rules of RM M13.2 are allergy, interaction and
 * duplicate, none of which is a function of the dose (see the "what is
 * NOT screened" note in `safety-screen.ts`). They are accepted and
 * ignored rather than rejected, so the stepper can post one body shape
 * at every step without the server pretending the dose changed the
 * verdict.
 */
export const safetyCheckSchema = z.object({
  patientId: handle,
  medicationId: uuid,
  dosage: z.string().trim().max(60).optional(),
  currentStep: z.coerce.number().int().min(1).max(4).optional(),
});

export type SafetyCheckInput = z.infer<typeof safetyCheckSchema>;

/** API §7.6 — create a draft. */
export const createPrescriptionSchema = z.object({
  patientId: handle,
  medicationId: uuid,
  strength: z.string().trim().min(1).max(30),
  dosage: z.string().trim().min(1).max(60),
  frequency: z.string().trim().min(1).max(60),
  /**
   * The three numeric bounds are the frontend's, verbatim.
   *
   * `authoring.ts:157-159` codes them as `MAX_DURATION_DAYS = 365`,
   * `MAX_QUANTITY = 1000`, `MAX_REFILLS = 11`, and rank-1 source is the
   * contract. A server that accepted 10 000 units where the stepper
   * refuses 1 001 would let the API write prescriptions the UI could
   * never have produced — and the API is the surface that actually
   * dispenses.
   *
   * The fourth rule from that function — a controlled medication cannot
   * carry refills — needs the catalogue row, so it is enforced in the
   * service where the medication has been loaded.
   */
  durationDays: z.coerce.number().int().min(1).max(365),
  quantity: z.coerce.number().int().min(1).max(1_000),
  refillsAllowed: z.coerce.number().int().min(0).max(11).default(0),
  instructions: z.string().trim().min(1).max(2_000),
  /** Optional link to the visit this was prescribed at (`MR-…`). */
  recordId: handle.optional(),
  /**
   * Defaults to today in the service rather than here, because "today"
   * is a clinic-timezone question and this file has no clock.
   */
  startDate: z.coerce.date().optional(),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;

/**
 * API §7.7 — sign & send.
 *
 * Both fields are optional *in the schema* and conditionally required by
 * the server: whether an acknowledgment is needed depends on what the
 * in-transaction re-run finds, which this file cannot know. Making them
 * required here would refuse a clean prescription that needs neither,
 * and making the check client-side would let a client decide it has
 * nothing to acknowledge.
 */
export const signPrescriptionSchema = z.object({
  acknowledgedWarningIds: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  reason: reason.optional(),
});

export type SignPrescriptionInput = z.infer<typeof signPrescriptionSchema>;

/** API §7.9 — `/discontinue` and `/cancel`. P4: the reason is not optional. */
export const discontinuePrescriptionSchema = z.object({ reason });

export type DiscontinuePrescriptionInput = z.infer<typeof discontinuePrescriptionSchema>;

/**
 * API §7.8 — renew.
 *
 * Every field is optional: a renewal with an empty body is "the same
 * again", which is the common case and the reason the endpoint exists.
 * What is supplied overrides the source prescription; what is not is
 * copied from it.
 */
export const renewPrescriptionSchema = z.object({
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
  quantity: z.coerce.number().int().min(1).max(1_000).optional(),
  refillsAllowed: z.coerce.number().int().min(0).max(11).optional(),
  instructions: z.string().trim().min(1).max(2_000).optional(),
  startDate: z.coerce.date().optional(),
});

export type RenewPrescriptionInput = z.infer<typeof renewPrescriptionSchema>;

/** API §7.10 — a note on the prescription. */
export const createPrescriptionNoteSchema = z.object({
  body: z.string().trim().min(1).max(4_000),
});

export type CreatePrescriptionNoteInput = z.infer<typeof createPrescriptionNoteSchema>;

/** API §7.3 — the list. */
const prescriptionFilters = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: multi(PRESCRIPTION_STATUS_VALUES),
  refillStatus: multi(REFILL_STATUS_VALUES),
  patientId: handle.optional(),
  medication: z.string().trim().min(1).max(120).optional(),
  department: z.string().trim().min(1).max(80).optional(),
  warningSeverity: z.enum(WARNING_SEVERITY_VALUES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['createdAt:asc', 'createdAt:desc']).default('createdAt:desc'),
});

function rangeInOrder(query: { from?: Date | undefined; to?: Date | undefined }): boolean {
  return query.from === undefined || query.to === undefined || query.from <= query.to;
}

const RANGE_ORDER = { message: '`from` must not be after `to`', path: ['from'] };

export const prescriptionListSchema = prescriptionFilters
  .extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(rangeInOrder, RANGE_ORDER);

export type PrescriptionListQuery = z.infer<typeof prescriptionListSchema>;

/**
 * `GET /prescriptions/export` — API §7.10. The list's filters, sort and
 * range rule without paging, bounded by `EXPORT_ROW_LIMIT`.
 */
export const prescriptionExportSchema = prescriptionFilters.refine(rangeInOrder, RANGE_ORDER);

export type PrescriptionExportQuery = z.infer<typeof prescriptionExportSchema>;
