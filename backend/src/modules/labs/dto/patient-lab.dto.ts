/**
 * The patient profile's Lab results tab (RM M15.3 — API §4.5).
 *
 * The shapes are the frontend's, verbatim and rank-1:
 * `PatientLabStudy` and `PatientLabStudyCategory` in
 * `features/shared-domain/lab-studies/patient-studies.ts`, which
 * `PatientLabStudiesTab` and `groupPatientLabStudies` already render.
 *
 * Two of the field names read oddly against this module's own
 * vocabulary and are kept anyway, because the mirror is the contract
 * (MG §18.5). `labId` is the `LAB-…` reference the rest of this module
 * calls `id`, and `date` is the resolved display instant rather than
 * one of the three columns it comes from.
 */

/** One row of the tab — `PatientLabStudy`, verbatim. */
export interface PatientLabStudyView {
  /** `LAB-…`; the tab links into the labs feature's detail route with it. */
  readonly labId: string;
  readonly testName: string;
  readonly testCode: string;
  readonly category: string;
  readonly status: string;
  /**
   * The date a clinician means by "when": released, else collected, else
   * ordered — `completedDate ?? collectedDate ?? requestedDate`, the
   * frontend's own resolution. An order still in the lab has no result
   * date, and showing its order date under a "Completed" heading would
   * misdate the result.
   */
  readonly date: string;
  /** Released analytes. An order still in the lab has none. */
  readonly resultCount: number;
  readonly abnormalCount: number;
  readonly hasCriticalResult: boolean;
  /** Reviewed per M14.5 — the same state the Labs screen writes. */
  readonly reviewed: boolean;
}

/** `PatientLabStudyCategory`, verbatim. */
export interface PatientLabStudyCategoryView {
  readonly id: string;
  readonly label: string;
  readonly studies: readonly PatientLabStudyView[];
}

/**
 * `GET /patients/{patientId}/labs`.
 *
 * `truncated` is reported rather than hidden. The repository caps the
 * history, and a tab that silently dropped the oldest studies would let
 * a clinician conclude a test was never done.
 */
export interface PatientLabStudiesView {
  readonly patientId: string;
  readonly categories: readonly PatientLabStudyCategoryView[];
  readonly totalStudies: number;
  readonly truncated: boolean;
}
