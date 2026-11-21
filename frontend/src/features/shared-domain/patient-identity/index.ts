/**
 * shared-domain/patient-identity — PUBLIC API (FRONTEND_ARCHITECTURE §3.3).
 * The one sanctioned cross-feature import point for patient identity:
 * the Patient model, its P8 metadata maps, the seeded mock roster, and
 * the deterministic-generation helpers. Moved here in Phase 5 when the
 * appointments feature became the second consumer (rule of three /
 * shared-domain promotion, §8.2).
 */
export * from './rng';
export * from './roster';
export * from './types';
export * from './directory';
export * from './directory-queries';
export { httpPatientDirectory, readPatientBloodType, toPatient } from './http-directory';
