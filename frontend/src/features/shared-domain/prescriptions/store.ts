import { MOCK_PRESCRIPTIONS } from './mock-data';
import type { Prescription, PrescriptionStatus } from './types';

/**
 * The demo's prescriptions for this tab — the one store the pharmacy writes
 * and the patient chart reads (NEW-05).
 *
 * It sits in shared-domain for the reason lab-studies' store does (D-05):
 * two features read it, the state is mutable, and §3.4 forbids `patients`
 * importing `pharmacy` — so moving only the seed would give each its own
 * copy, and a course discontinued in the pharmacy would still be running on
 * the chart. In memory, never `localStorage`: prescriptions are PHI. Demo
 * mode only; a live build reads `GET /patients/:id/medications` for both.
 */
const prescriptions = new Map<string, Prescription>(
  MOCK_PRESCRIPTIONS.map((prescription) => [prescription.id, prescription]),
);

/**
 * The map itself, for the pharmacy's demo service — the store's one writer,
 * which reads and writes it exactly as it did its own. Everyone else uses
 * the functions below.
 */
export const prescriptionStore: Map<string, Prescription> = prescriptions;

export function prescriptionById(id: string): Prescription | undefined {
  return prescriptions.get(id);
}

export function allPrescriptions(): Prescription[] {
  return Array.from(prescriptions.values());
}

export function putPrescription(prescription: Prescription): void {
  prescriptions.set(prescription.id, prescription);
}

/** Test-only: back to the seed. */
export function resetPrescriptionStore(): void {
  prescriptions.clear();
  for (const prescription of MOCK_PRESCRIPTIONS) prescriptions.set(prescription.id, prescription);
}

/** The chart's medication statuses (`patients/model/profile-types.ts`). */
export type MedicationOnChartStatus = 'active' | 'completed' | 'discontinued';

/** A prescription as the patient's medication tab shows it. */
export interface MedicationOnChart {
  readonly id: string;
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  /** `YYYY-MM-DD`, as the live adapter reads `startDate`. */
  readonly startDate: string;
  readonly endDate: string | null;
  readonly prescriptionId: string;
  readonly status: MedicationOnChartStatus;
}

/**
 * Still running — the strip's `CURRENT_PRESCRIPTION_STATUSES`, so the
 * chart's "active" and the strip's list are the same set by construction.
 */
const RUNNING: ReadonlySet<PrescriptionStatus> = new Set([
  'active',
  'dispensed',
  'pending-approval',
]);
const ENDED_EARLY: ReadonlySet<PrescriptionStatus> = new Set(['discontinued']);

/**
 * A patient's medications as `GET /patients/:id/medications` materialises
 * them from prescriptions: every issued prescription (a draft was never
 * issued), running ones active, a stopped one discontinued, the rest
 * completed. Newest first.
 */
export function medicationsOnChart(patientId: string): MedicationOnChart[] {
  return allPrescriptions()
    .filter((rx) => rx.patient.id === patientId && rx.status !== 'draft')
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((rx) => ({
      id: rx.id,
      name: rx.medication.name,
      dosage: rx.dosage,
      frequency: rx.frequency,
      startDate: rx.startDate.slice(0, 10),
      endDate: rx.endDate.length > 0 ? rx.endDate.slice(0, 10) : null,
      prescriptionId: rx.id,
      status: RUNNING.has(rx.status)
        ? 'active'
        : ENDED_EARLY.has(rx.status)
          ? 'discontinued'
          : 'completed',
    }));
}
