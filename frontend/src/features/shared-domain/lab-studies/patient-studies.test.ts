import { beforeEach, describe, expect, it } from 'vitest';

import { MOCK_LAB_TESTS } from './corpus';
import {
  groupPatientLabStudies,
  patientLabStudies,
  unreviewedStudyCount,
} from './patient-studies';
import { __resetLabStudies } from './store';
import { LAB_CATEGORIES, abnormalResultCount } from './types';

/**
 * The patient-scoped projection behind the profile's "Lab results" tab
 * (D-05). These assert the projection *carries* the order's own fields
 * rather than recomputing them — the failure mode D-05 exists to prevent is
 * two screens describing one result differently.
 */

const patientId = MOCK_LAB_TESTS[0]?.patient.id ?? '';

beforeEach(() => {
  __resetLabStudies();
});

describe('patientLabStudies', () => {
  it('returns every order for the patient, and only that patient', () => {
    const studies = patientLabStudies(patientId);
    const expected = MOCK_LAB_TESTS.filter((test) => test.patient.id === patientId);

    expect(studies).toHaveLength(expected.length);
    expect(studies.length).toBeGreaterThan(0);

    const ids = new Set(studies.map((study) => study.labId));
    for (const test of expected) expect(ids.has(test.id)).toBe(true);
  });

  it('carries flags through from the order instead of re-deriving them', () => {
    for (const study of patientLabStudies(patientId)) {
      const source = MOCK_LAB_TESTS.find((test) => test.id === study.labId);
      expect(source).toBeDefined();
      expect(study.testName).toBe(source?.testName);
      expect(study.status).toBe(source?.status);
      expect(study.category).toBe(source?.category);
      expect(study.hasCriticalResult).toBe(source?.hasCriticalResult);
      expect(study.resultCount).toBe(source?.results.length);
      expect(study.abnormalCount).toBe(abnormalResultCount(source!));
      expect(study.reviewed).toBe(source?.review !== null);
    }
  });

  it('dates a study by release, then collection, then order', () => {
    for (const study of patientLabStudies(patientId)) {
      const source = MOCK_LAB_TESTS.find((test) => test.id === study.labId);
      expect(study.date).toBe(
        source?.completedDate ?? source?.collectedDate ?? source?.requestedDate,
      );
    }
  });

  it('orders newest first', () => {
    const dates = patientLabStudies(patientId).map((study) => study.date);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('is empty for a patient with no lab work, rather than throwing', () => {
    expect(patientLabStudies('PT-does-not-exist')).toEqual([]);
  });
});

describe('groupPatientLabStudies', () => {
  const studies = patientLabStudies(patientId);

  it('omits empty categories rather than rendering them as empty cards', () => {
    for (const group of groupPatientLabStudies(studies)) {
      expect(group.studies.length).toBeGreaterThan(0);
    }
  });

  it('keeps the catalogue order and loses no study', () => {
    const groups = groupPatientLabStudies(studies);
    const order = groups.map((group) => LAB_CATEGORIES.indexOf(group.id));
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const grouped = groups.flatMap((group) => group.studies);
    expect(grouped).toHaveLength(studies.length);
  });
});

describe('unreviewedStudyCount', () => {
  it('counts only released results, because an order still in the lab cannot be reviewed', () => {
    const studies = patientLabStudies(patientId);
    const counted = studies.filter((study) => study.resultCount > 0 && !study.reviewed);

    expect(unreviewedStudyCount(studies)).toBe(counted.length);
    // An unreleased order must never be counted as outstanding review work.
    expect(counted.every((study) => study.resultCount > 0)).toBe(true);
  });
});
