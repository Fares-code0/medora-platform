import { listLabTests } from './store';
import {
  LAB_CATEGORIES,
  abnormalResultCount,
  type LabTest,
  type LabTestCategory,
  type LabTestStatus,
} from './types';

/**
 * The patient-scoped projection the profile's "Lab results" tab renders
 * (D-05). It is deliberately narrower than `LabTest`: the profile lists what
 * exists and links out, and the labs feature owns reading a result. Nothing
 * here re-derives a flag or a status — every field is carried through from
 * the order, so the tab cannot describe a result differently from the screen
 * that owns it.
 */

export interface PatientLabStudiesResult {
  readonly studies: readonly PatientLabStudy[];
  /** The source kept only the most recent studies (the server's cap is 500). */
  readonly truncated: boolean;
}

export interface PatientLabStudy {
  readonly labId: string;
  readonly testName: string;
  readonly testCode: string;
  readonly category: LabTestCategory;
  readonly status: LabTestStatus;
  /**
   * The date a clinician means by "when": released, else collected, else
   * ordered. An order still in the lab has no result date, and showing its
   * order date under a "Completed" heading would misdate the result.
   */
  readonly date: string;
  /** Released analytes. An order still in the lab has none. */
  readonly resultCount: number;
  readonly abnormalCount: number;
  readonly hasCriticalResult: boolean;
  /** D-11's review state, read from the same store the Labs screen writes. */
  readonly reviewed: boolean;
}

export interface PatientLabStudyCategory {
  readonly id: LabTestCategory;
  readonly label: LabTestCategory;
  readonly studies: readonly PatientLabStudy[];
}

function toPatientStudy(test: LabTest): PatientLabStudy {
  const released = test.status === 'completed';
  return {
    labId: test.id,
    testName: test.testName,
    testCode: test.testCode,
    category: test.category,
    status: test.status,
    date: test.completedDate ?? test.collectedDate ?? test.requestedDate,
    // Released analytes only: a processing order can already carry values,
    // and the chart's "awaiting review" count must not include them.
    resultCount: released ? test.results.length : 0,
    abnormalCount: released ? abnormalResultCount(test) : 0,
    hasCriticalResult: released && test.hasCriticalResult,
    reviewed: test.review !== null,
  };
}

/** Every lab order for one patient, newest first. */
export function patientLabStudies(patientId: string): readonly PatientLabStudy[] {
  return listLabTests()
    .filter((test) => test.patient.id === patientId)
    .map(toPatientStudy)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Groups studies under their lab category, in the catalogue's own order.
 *
 * Empty categories are omitted rather than rendered as empty cards: the
 * placeholder tab this replaces printed "No studies yet." under headings the
 * patient had never had work ordered in, which reads as missing data rather
 * than as absence of an order.
 */
export function groupPatientLabStudies(
  studies: readonly PatientLabStudy[],
): readonly PatientLabStudyCategory[] {
  return LAB_CATEGORIES.map((category) => ({
    id: category,
    label: category,
    studies: studies.filter((study) => study.category === category),
  })).filter((group) => group.studies.length > 0);
}

/** Unreviewed released results — what the profile's tab count should mean. */
export function unreviewedStudyCount(studies: readonly PatientLabStudy[]): number {
  return studies.filter((study) => study.resultCount > 0 && !study.reviewed).length;
}
