/**
 * The patient-facing information layer.
 *
 * ── What this feature is, and what it is not ─────────────────────────
 *
 * Owner decision (2026-11-26, ADR-050): **the patient never sees the full
 * medical record, physician notes, internal documentation or unrestricted
 * history.** What a patient CAN see is a separate, deliberately thin
 * layer: the *status* of tests that were ordered for them, and the
 * insurance they have on file. That is all this feature models.
 *
 * Absent by design, and not "not built yet":
 *
 *  - allergies, conditions, medicines, history, prescriptions, visit
 *    summaries and documents — the record is read with the care team;
 *  - any lab RESULT, value, flag or interpretation. Whether and when a
 *    result is released to a patient is a clinical policy (ADR-031),
 *    which is not approved. There is no field here a result could be put
 *    in, so no screen can render one by accident.
 *
 * The old types (`Allergy`, `LabResult`, `ReleaseState` handling, …) were
 * deleted with the screens that rendered them, rather than left as dead
 * model that a future screen could quietly pick back up.
 */

/** What the server's laboratory workflow is, said the way a patient would. */
export type LabTestStatus = 'awaiting_collection' | 'in_progress' | 'completed' | 'cancelled';

export interface LabTest {
  readonly id: string;
  readonly testName: string;
  readonly category: string | null;
  readonly specimenType: string | null;
  readonly status: LabTestStatus;
  readonly requestedAt: string;
  readonly collectedAt: string | null;
  readonly completedAt: string | null;
  readonly hospitalName: string | null;
}

/** The insurance on file. `policyNumberLast4` is the only part of the number that ever arrives. */
export interface InsuranceOnFile {
  readonly providerName: string;
  readonly plan: string | null;
  readonly policyNumberLast4: string;
  readonly validUntil: string | null;
  readonly isActive: boolean;
}

/**
 * `insurance` is `null` when nothing is on file — an answer, not an error.
 *
 * Authorization (approval/rejection of a service) is not modelled: the
 * state machine is undecided (ADR-039 item 5) and the server says so. The
 * screen renders that as an honest notice, never as "no authorizations".
 */
export interface InsuranceView {
  readonly insurance: InsuranceOnFile | null;
}

/**
 * A person the clinic would call about this patient — checklist N-08.
 *
 * Kept here, unchanged, because the Emergency screen reads it through
 * this service and it is not part of the record being withdrawn: it is
 * the patient's own contact list. No route serves it today (BE-09), so
 * production refuses by name and the Emergency screen says so.
 *
 * **Read-only**: the clinic records who to call.
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

export interface LabTestPage {
  readonly items: readonly LabTest[];
  readonly totalItems: number;
  readonly hasMore: boolean;
}

export interface HealthService {
  /** `GET /me/lab-orders` — status only, one page at a time. */
  listLabTests(page: number): Promise<LabTestPage>;
  /** `GET /me/insurance`. */
  getInsurance(): Promise<InsuranceView>;
  /** N-08. Rendered by the Emergency screen. Not served yet (BE-09). */
  listEmergencyContacts(): Promise<readonly EmergencyContact[]>;
}
