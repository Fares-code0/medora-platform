import type {
  AllergySeverity,
  DocumentCategory,
  HistoryEventKind,
  LabResultFlag,
  LabStatus,
  MedicationStatus,
  PrescriptionStatus,
  ReleaseState,
} from '@/types/vocabularies';

/**
 * Health records and lab results.
 *
 * ── The gate this feature is built around (audit AD-5) ───────────────
 *
 * **Not every clinical record is automatically visible to the patient.**
 * Whether someone may see a `critical-high` result before a clinician has
 * reviewed it is a clinical policy decision with a named owner, not a UI
 * toggle. `lab_orders.reviewed_by` and `criticalUnreviewed` already exist
 * on the backend; the release POLICY does not.
 *
 * So every record here carries a `release: ReleaseState`, and the screens
 * render four outcomes honestly:
 *
 *   released       show it
 *   pending-review held until a clinician has looked at it — say so, and
 *                  give a route to ask
 *   not-released   the clinic has not shared this — say so
 *   unavailable    it exists but cannot be fetched right now
 *
 * The client does NOT decide which state a record is in. It renders the
 * state the server sends. A client that hid a result based on its own
 * reading of `flag` would be implementing clinical policy in a phone app,
 * and would show the result anyway to anyone with a proxy.
 *
 * ── And what is NOT here ─────────────────────────────────────────────
 * No interpretation. No "your cholesterol is high, consider…". No
 * reference-range verdict beyond the flag the lab itself set. Rendering a
 * clinical interpretation is practising medicine (§19 of the brief).
 */

export interface Allergy {
  readonly id: string;
  readonly allergen: string;
  readonly severity: AllergySeverity;
  readonly reaction: string | null;
  readonly release: ReleaseState;
}

export interface ChronicCondition {
  readonly id: string;
  readonly name: string;
  readonly diagnosedOn: string | null;
  readonly release: ReleaseState;
}

export interface Medication {
  readonly id: string;
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  readonly status: MedicationStatus;
  readonly startedOn: string | null;
  readonly release: ReleaseState;
}

export interface HistoryEvent {
  readonly id: string;
  readonly kind: HistoryEventKind;
  readonly title: string;
  readonly occurredOn: string;
  readonly detail: string | null;
  readonly release: ReleaseState;
}

export interface LabOrder {
  readonly id: string;
  readonly panelName: string;
  readonly orderedOn: string;
  readonly status: LabStatus;
  readonly release: ReleaseState;
  readonly resultCount: number;
}

export interface LabResult {
  readonly id: string;
  readonly analyteName: string;
  /** Rendered as text. Never compared, never interpreted. */
  readonly value: string | null;
  readonly unit: string | null;
  /** The lab's own reference range, as a display string. */
  readonly referenceRange: string | null;
  /** The LAB's flag. Not a client judgement. */
  readonly flag: LabResultFlag | null;
  readonly release: ReleaseState;
}

export interface LabOrderDetail extends LabOrder {
  readonly results: readonly LabResult[];
}

export interface Prescription {
  readonly id: string;
  readonly medicationName: string;
  readonly dosage: string;
  readonly frequency: string;
  readonly status: PrescriptionStatus;
  readonly issuedOn: string;
  readonly refillsRemaining: number | null;
  readonly release: ReleaseState;
}

export interface VisitSummary {
  readonly id: string;
  readonly title: string;
  readonly visitedOn: string;
  readonly doctorName: string;
  /** A patient-appropriate projection, NOT the clinician's document. */
  readonly summary: string | null;
  readonly release: ReleaseState;
}

export interface PatientDocument {
  readonly id: string;
  readonly title: string;
  readonly category: DocumentCategory;
  readonly uploadedOn: string;
  /**
   * `File` has a scan gate: a download is `403 scan_pending` until the
   * file is scanned clean. That is NOT an error to retry past
   * (checklist J-09).
   */
  readonly scanState: 'clean' | 'pending' | 'blocked';
  readonly release: ReleaseState;
}

/**
 * A person the clinic would call about this patient — checklist N-08.
 *
 * ── Why this lives with the health record and not with Emergency ─────
 *
 * `patient_emergency_contacts` is a row of the patient's clinical record
 * and reads through `GET /me/health/*` (BE-09) like the rest of it. The
 * Emergency *screen* renders it, but the emergency *service* must not
 * own it: that service never throws and needs no session, because the
 * screen it feeds has to render in airplane mode from the signed-out
 * stack. A contact list needs both. Putting it there would have made the
 * one screen that must never fail depend on a call that can.
 *
 * **Read-only, and that is a data-ownership fact rather than a phase.**
 * The clinic records who to call, and a patient editing it here would be
 * editing a clinician's record through a screen designed for a crisis.
 * RA-030.2 is the decision that would change it, and it is open.
 */
export interface EmergencyContact {
  readonly id: string;
  readonly name: string;
  /** "Sister", "Husband", "Neighbour" — the clinic's own wording. */
  readonly relationship: string | null;
  readonly phone: string;
  /** The clinic calls this one first. At most one row is primary. */
  readonly primary: boolean;
}

export interface HealthService {
  listAllergies(): Promise<readonly Allergy[]>;
  listConditions(): Promise<readonly ChronicCondition[]>;
  listMedications(): Promise<readonly Medication[]>;
  listHistory(): Promise<readonly HistoryEvent[]>;
  listLabOrders(): Promise<readonly LabOrder[]>;
  getLabOrder(id: string): Promise<LabOrderDetail>;
  listPrescriptions(): Promise<readonly Prescription[]>;
  listVisits(): Promise<readonly VisitSummary[]>;
  listDocuments(): Promise<readonly PatientDocument[]>;
  /** N-08. Rendered by the Emergency screen; owned by the record. */
  listEmergencyContacts(): Promise<readonly EmergencyContact[]>;
}
