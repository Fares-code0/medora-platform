/**
 * Status vocabularies — the backend's enum literals, verbatim.
 *
 * "Field names are law" (API contract §11 header), and a fourth client is
 * a fourth place a literal can drift (audit R-11). Every union below is
 * transcribed from `backend/prisma/schema/01-enums.prisma` in the
 * database's own kebab-case wire form — `no-show`, `awaiting-patient`,
 * `critical-low`, `pending-approval`, `external-record` — not in a
 * prettier local spelling.
 *
 * `src/test/parity.test.ts` reads that Prisma file and fails if any union
 * here diverges from it. That is the same discipline the backend applies
 * to the frontend's permission catalogue, and it is what makes this file a
 * binding rather than a copy.
 *
 * ── What is NOT here ─────────────────────────────────────────────────
 * Any vocabulary this app must not consume. `AiContextMode` is absent
 * because its members (`record`, `labs`, `pharmacy`) are clinician
 * contexts and a patient AI needs its own vocabulary that ADR-030's
 * successor has not defined yet (audit §9, checklist K-01).
 */

/**
 * ADR-001. Eight states, server-owned.
 *
 * The transition table is NOT transcribed here, and that omission is the
 * single most important design constraint in the appointments feature
 * (audit §6): the client never computes whether an action is allowed. It
 * renders the actions the server offers and renders `409 conflict` when
 * it loses a race. A cancellation window is the server's rule.
 */
export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'pending',
  'completed',
  'cancelled',
  'rescheduled',
  'no-show',
  'awaiting-patient',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type AppointmentPriority = (typeof APPOINTMENT_PRIORITIES)[number];

export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

export const MEDICATION_STATUSES = ['active', 'completed', 'discontinued'] as const;
export type MedicationStatus = (typeof MEDICATION_STATUSES)[number];

export const HISTORY_EVENT_KINDS = [
  'diagnosis',
  'surgery',
  'procedure',
  'hospitalization',
  'vaccination',
] as const;
export type HistoryEventKind = (typeof HISTORY_EVENT_KINDS)[number];

export const LAB_STATUSES = [
  'ordered',
  'collected',
  'processing',
  'completed',
  'cancelled',
] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];

/**
 * `critical-low`, `critical-high` and `abnormal` are exactly the flags
 * AD-5 gates: whether a patient may see one before a clinician has
 * reviewed it is a clinical policy decision, not a UI toggle. The union
 * is complete so the presentation map can be exhaustive; the *release*
 * decision is the server's (`lab_orders.reviewed_by`).
 */
export const LAB_RESULT_FLAGS = [
  'normal',
  'low',
  'high',
  'critical-low',
  'critical-high',
  'abnormal',
] as const;
export type LabResultFlag = (typeof LAB_RESULT_FLAGS)[number];

export const PRESCRIPTION_STATUSES = [
  'draft',
  'pending-approval',
  'active',
  'dispensed',
  'completed',
  'discontinued',
  'expired',
] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export const MESSAGE_STATUSES = ['sending', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  'referral',
  'consent',
  'external-record',
  'insurance',
  'report',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const NOTIFICATION_CATEGORIES = [
  'appointments',
  'medical-records',
  'laboratory',
  'pharmacy',
  'patients',
  'ai',
  'system',
  'security',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_PRIORITIES = ['normal', 'important', 'critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/**
 * `AnnouncementPriority` — a clinic announcement's, not a
 * notification's, and the two are deliberately different words for
 * different things. A notification is addressed to one person and its
 * `critical` means "this phone should ring at 3am"; an announcement is
 * addressed to everyone who uses the clinic and its `high` means "read
 * this before your next visit". The parity test binds both.
 */
export const ANNOUNCEMENT_PRIORITIES = ['low', 'normal', 'high'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

/**
 * The patient-facing *release* state of a record or result.
 *
 * This one is NOT a backend enum, and saying so is the point. AD-5 has
 * not been decided, so the shape a released/withheld record takes on the
 * wire does not exist yet. The UI still has to be able to render "held
 * for clinician review" honestly rather than as a blank or an error, so
 * the states live here as a CLIENT vocabulary with no invented endpoint
 * behind them. When AD-5 lands, this union is replaced by whatever the
 * contract says — and the screens do not move, because they already
 * branch on these five.
 */
export const RELEASE_STATES = [
  'released',
  'pending-review',
  'not-released',
  'unavailable',
] as const;
export type ReleaseState = (typeof RELEASE_STATES)[number];
