/**
 * Lab studies (D-05) — the laboratory model, its seeded corpus and its
 * session store, shared by the labs feature (which owns the screens and every
 * write rule) and the patient profile (which lists a patient's orders and
 * links out). Neither imports the other (§3.3, §3.4).
 */
export { TEST_CATALOGUE, type AnalyteSpec, type TestSpec } from './catalogue';
export { MOCK_LAB_TESTS } from './corpus';
export {
  groupPatientLabStudies,
  patientLabStudies,
  unreviewedStudyCount,
  type PatientLabStudiesResult,
  type PatientLabStudy,
  type PatientLabStudyCategory,
} from './patient-studies';
export { labStudyKeys, usePatientLabStudiesQuery } from './queries';
export { __resetLabStudies, getLabTest, listLabTests, putLabTest } from './store';
export * from './types';
