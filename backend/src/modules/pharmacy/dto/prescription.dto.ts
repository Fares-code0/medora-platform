/**
 * The prescription document (API §7.3, §7.4).
 *
 * Field names are the frontend's `Prescription` verbatim — the contract's
 * §11 header calls these literals law, and `pharmacy/model/types.ts:245`
 * is the type the list and detail pages already render.
 *
 * Two shapes the frontend model fixes and this mirrors:
 *
 *  - `medication` is a **snapshot with a singular `strength`**, because
 *    one strength was chosen when the prescription was written. The
 *    catalogue's `strengths[]` (`medication.dto.ts`) is the other side
 *    of that choice.
 *  - `duration` is a human string *and* `durationDays` a number. The
 *    frontend declares both; the string is what the document prints and
 *    the number is what the expiry sweep computes on.
 */

export interface PrescriptionPatientSnapshot {
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly age: number;
  readonly gender: string;
  readonly bloodType: string;
  readonly phone: string;
  /** Allergen names only — the severity is carried by `hasSevereAllergy`. */
  readonly allergies: readonly string[];
  readonly hasSevereAllergy: boolean;
}

export interface PrescriptionMedicationSnapshot {
  readonly id: string;
  readonly name: string;
  readonly genericName: string;
  readonly category: string;
  /** The one chosen at prescribing time. */
  readonly strength: string;
  readonly form: string;
  readonly route: string;
  readonly manufacturer: string;
  readonly isControlled: boolean;
  readonly isHighRisk: boolean;
  readonly interactionNote: string | null;
  readonly allergyClass: string | null;
}

export interface PrescriptionWarningView {
  readonly id: string;
  readonly kind: string;
  readonly severity: string;
  readonly title: string;
  readonly detail: string;
  /**
   * Present when the prescriber acknowledged this warning to sign. The
   * reason is the audit trail UX §2.7 requires, and it is what a later
   * review reads.
   */
  readonly acknowledgedReason: string | null;
  readonly acknowledgedAt: string | null;
}

export interface PrescriptionNoteView {
  readonly id: string;
  readonly author: string;
  readonly authoredAt: string;
  readonly body: string;
}

export interface MedicationHistoryEntryView {
  readonly id: string;
  readonly date: string;
  readonly event: string;
  readonly detail: string;
}

export interface PrescriptionTimelineEventView {
  readonly id: string;
  readonly kind: string;
  readonly at: string;
  readonly actor: string;
  readonly detail: string;
}

export interface PrescriptionView {
  /** `RX-…`. */
  readonly id: string;
  readonly patient: PrescriptionPatientSnapshot;
  readonly medication: PrescriptionMedicationSnapshot;
  readonly dosage: string;
  readonly frequency: string;
  readonly route: string;
  /** Human form, e.g. "30 days". */
  readonly duration: string;
  readonly durationDays: number;
  readonly quantity: number;
  readonly instructions: string;
  readonly prescribingDoctor: string;
  readonly department: string | null;
  readonly status: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly refillsAllowed: number;
  readonly refillsRemaining: number;
  readonly refillStatus: string;
  readonly warnings: readonly PrescriptionWarningView[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Null until `/sign`; the biconditional CHECK ties it to the status. */
  readonly signedAt: string | null;
  readonly discontinuedReason: string | null;
  /** The visit this was prescribed at (`MR-…`), when there was one. */
  readonly recordId: string | null;
}

export interface PrescriptionDetailView extends PrescriptionView {
  readonly notes: readonly PrescriptionNoteView[];
  readonly history: readonly MedicationHistoryEntryView[];
  readonly timeline: readonly PrescriptionTimelineEventView[];
}

/**
 * `GET /prescriptions/summary` — API §7, RM M27.4.
 *
 * Field names and definitions transcribed from the frontend's
 * `summarizePrescriptions` (`pharmacy/model/selectors.ts`), which is what
 * `PharmacySummaryCards` renders. `newToday` counts prescriptions
 * **created** today, not signed today, because that is what the function
 * being replaced counts — changing the definition while keeping the name
 * would silently alter a card an existing screen already shows.
 */
export interface PrescriptionSummaryView {
  readonly total: number;
  readonly active: number;
  readonly pendingRefills: number;
  readonly expired: number;
  readonly highRisk: number;
  readonly newToday: number;
}
