import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetLabStudies,
  patientLabStudies,
  putLabTest,
  unreviewedStudyCount,
} from '@/features/shared-domain/lab-studies';

import { LabResultsSection } from '../components/detail/LabResultsSection';
import { LabFlagCell } from '../components/LabCells';

import {
  hasPreliminaryResults,
  hasReleasedResults,
  inboxTests,
  partitionForBulkReview,
  reviewState,
} from './review';
import { filterLabTests, summarizeLabTests } from './selectors';
import type { LabResultFlag, LabResultItem, LabTest } from './types';

/**
 * The laboratory enters values while an order is processing and releases them
 * by completing it (API §8.6, the server's `assertResultable`). The frontend
 * read "has results" as "released", so a processing order's provisional values
 * reached the review queue, the flag filters, the Critical card and the
 * chart's counts, and a provisional critical value was announced as
 * "Flagged to the ordering team" before any notification existed.
 */

afterEach(() => {
  __resetLabStudies();
});

function result(flag: LabResultFlag): LabResultItem {
  return {
    id: `r-${flag}`,
    analyte: 'Potassium',
    value: flag === 'critical-high' ? '6.8' : '4.2',
    numericValue: flag === 'critical-high' ? 6.8 : 4.2,
    unit: 'mmol/L',
    referenceRange: { low: 3.5, high: 5.1, text: '3.5–5.1' },
    flag,
  };
}

function order(id: string, status: LabTest['status'], flag: LabResultFlag): LabTest {
  return {
    id,
    patient: {
      id: 'PT-PRELIM',
      name: 'Rana Saleh',
      mrn: 'MRN-PRELIM',
      age: 51,
      gender: 'female',
      bloodType: 'A+',
      phone: '01000000000',
    },
    testName: 'Basic metabolic panel',
    testCode: 'BMP',
    category: 'Chemistry',
    department: 'General Medicine',
    orderedBy: 'Dr. Amelia Chen',
    clinicalIndication: 'Routine',
    status,
    priority: 'routine',
    requestedDate: '2026-10-01T08:00:00.000Z',
    collectedDate: '2026-10-01T09:00:00.000Z',
    completedDate: status === 'completed' ? '2026-10-01T12:00:00.000Z' : null,
    specimen: null,
    results: [result(flag)],
    interpretation: null,
    hasCriticalResult: flag === 'critical-high',
    review: null,
    attachments: [],
    annotations: [],
    timeline: [],
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
}

const PROCESSING_CRITICAL = order('LAB-PRELIM-1', 'processing', 'critical-high');
const PROCESSING_NORMAL = order('LAB-PRELIM-2', 'processing', 'normal');
const RELEASED_CRITICAL = order('LAB-PRELIM-3', 'completed', 'critical-high');

const NO_FILTERS = {
  status: null,
  category: null,
  priority: null,
  department: null,
  doctor: null,
  from: null,
  to: null,
  flag: null,
  review: null,
  patient: null,
} as const;

describe('released means completed', () => {
  it('treats values on a processing order as preliminary, not released', () => {
    expect(hasReleasedResults(PROCESSING_CRITICAL)).toBe(false);
    expect(hasPreliminaryResults(PROCESSING_CRITICAL)).toBe(true);
    expect(hasReleasedResults(RELEASED_CRITICAL)).toBe(true);
    expect(hasPreliminaryResults(RELEASED_CRITICAL)).toBe(false);
  });

  it('keeps a processing order out of the review queue', () => {
    expect(reviewState(PROCESSING_CRITICAL)).toBe('not-required');
    expect(inboxTests([PROCESSING_CRITICAL, RELEASED_CRITICAL]).map((t) => t.id)).toEqual([
      RELEASED_CRITICAL.id,
    ]);
  });

  it('refuses a processing order from bulk review as having nothing released', () => {
    const { eligible, refused } = partitionForBulkReview([PROCESSING_NORMAL]);
    expect(eligible).toEqual([]);
    expect(refused.map((entry) => entry.reason)).toEqual(['no-results']);
  });

  it('matches flag filters and the Critical card on released values only', () => {
    const tests = [PROCESSING_CRITICAL, RELEASED_CRITICAL];
    expect(filterLabTests(tests, '', { ...NO_FILTERS, flag: 'critical' }).map((t) => t.id)).toEqual(
      [RELEASED_CRITICAL.id],
    );
    expect(summarizeLabTests(tests).critical).toBe(1);
  });

  it("leaves a processing order's values out of the chart's counts", () => {
    putLabTest(PROCESSING_CRITICAL);
    const [study] = patientLabStudies('PT-PRELIM');

    expect(study).toMatchObject({ resultCount: 0, abnormalCount: 0, hasCriticalResult: false });
    expect(unreviewedStudyCount(patientLabStudies('PT-PRELIM'))).toBe(0);
  });
});

describe('LabResultsSection on a processing order', () => {
  it('labels the values preliminary', () => {
    render(<LabResultsSection test={PROCESSING_NORMAL} />);

    expect(screen.getByText('Preliminary results')).toBeInTheDocument();
    expect(
      screen.getByText('Preliminary values, not yet released by the laboratory.'),
    ).toBeInTheDocument();
  });

  it('does not claim a provisional critical value was flagged to anyone', () => {
    render(<LabResultsSection test={PROCESSING_CRITICAL} />);

    expect(
      screen.getByText(/Not yet released — the ordering team is notified/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Flagged to the ordering team/)).not.toBeInTheDocument();
  });

  it('still says a released critical value was flagged, with no preliminary label', () => {
    render(<LabResultsSection test={RELEASED_CRITICAL} />);

    expect(screen.getByText(/Flagged to the ordering team/)).toBeInTheDocument();
    expect(screen.queryByText('Preliminary results')).not.toBeInTheDocument();
  });
});

describe('the worklist flag column on a processing order', () => {
  it('says Preliminary instead of showing a flag as final', () => {
    render(<LabFlagCell test={PROCESSING_CRITICAL} />);

    expect(screen.getByText('Preliminary')).toBeInTheDocument();
    expect(screen.getByText('Not yet released')).toBeInTheDocument();
    expect(screen.queryByText('Critical high')).not.toBeInTheDocument();
  });

  it('still shows the worst released flag', () => {
    render(<LabFlagCell test={RELEASED_CRITICAL} />);

    expect(screen.getByText('Critical high')).toBeInTheDocument();
    expect(screen.queryByText('Preliminary')).not.toBeInTheDocument();
  });
});
