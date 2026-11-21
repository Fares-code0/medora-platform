/**
 * The formulary as the prescribing stepper reads it (API §7.1, §7.2).
 *
 * ## Why this is not the frontend's `Medication` verbatim
 *
 * `pharmacy/model/types.ts:128` declares `Medication` with a **singular**
 * `strength: string`. That type describes the medication *as recorded on
 * a prescription* — one strength was chosen, and the row carries it. The
 * catalogue is the other side of that choice: it must offer every
 * dispensable strength, which DB §F2 stores as `medication_strengths`
 * rows. So this DTO carries `strengths: string[]` and the prescription's
 * own medication snapshot (`prescription.dto.ts`) carries `strength`.
 * Both spell every shared field exactly as the frontend does — the
 * contract's §11 field-name law — and neither invents a value.
 *
 * `id` is added for the same reason: §7.5 and §7.6 take a `medicationId`
 * in the body, so the catalogue has to hand one out. The frontend model
 * has no `id` because a mock array is indexed by position.
 *
 * `frequencies` and `durationsDays` come straight from DB §F1's columns.
 * They are what the stepper's two dropdowns are made of; serving the
 * catalogue without them would leave the client inventing dosing options,
 * which is the one thing a formulary exists to prevent.
 */

export interface MedicationView {
  readonly id: string;
  readonly name: string;
  readonly genericName: string;
  readonly category: string;
  /** Every dispensable strength, in the catalogue's own order (DB §F2). */
  readonly strengths: readonly string[];
  readonly form: string;
  readonly route: string;
  readonly manufacturer: string;
  /** Controlled substance — drives the controlled filter and the chip. */
  readonly isControlled: boolean;
  /** High-alert medication (anticoagulant, insulin, opioid). */
  readonly isHighRisk: boolean;
  /** The canned note of DB §F1. **Not** the safety source — ADR-010 §8. */
  readonly interactionNote: string | null;
  /** Matched against `patient_allergies.allergen` by the §7.5 screen. */
  readonly allergyClass: string | null;
  readonly frequencies: readonly string[];
  readonly durationsDays: readonly number[];
}

/**
 * API §7.2 — prescribing reference, explicitly read-only.
 *
 * Every field is nullable because `medication_monographs` types them
 * that way: a monograph that has an indication but no pregnancy category
 * is a real, partially-populated reference entry, and forcing a string
 * would mean inventing one.
 */
export interface MedicationMonographView {
  readonly medicationId: string;
  readonly name: string;
  readonly genericName: string;
  readonly indications: string | null;
  readonly contraindications: string | null;
  readonly standardDosing: string | null;
  /** A, B, C, D or X — a single letter, never prose (DB §F8). */
  readonly pregnancyCategory: string | null;
  readonly warnings: string | null;
  readonly sideEffects: string | null;
}
