/**
 * The prescription model lives in `shared-domain/prescriptions` (NEW-05):
 * the patient chart's demo medications read the same prescriptions the
 * pharmacy writes, and §3.4 forbids `patients` importing `pharmacy`. This
 * re-export keeps the pharmacy's importers unchanged — the D-05 move.
 */
export * from '@/features/shared-domain/prescriptions/types';
