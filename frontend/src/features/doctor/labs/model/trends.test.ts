import { describe, expect, it } from 'vitest';

import { MOCK_LAB_TESTS } from '@/features/shared-domain/lab-studies';

import {
  MAX_TREND_SERIES,
  buildAnalyteTrend,
  toneForSeries,
  trendBand,
  trendDomain,
  trendTableRows,
  trendableAnalytes,
  trendsFromTests,
  type AnalyteTrend,
} from './trends';
import type { LabResultFlag, LabResultItem, LabTest } from './types';

/**
 * The trend derivations (D-13). Two properties carry most of the weight:
 * the y-window never anchors at zero (a lab range would be unreadable), and
 * the reference band disappears rather than being drawn for the wrong series.
 */

let sequence = 0;

function result(
  analyte: string,
  numericValue: number | null,
  flag: LabResultFlag = 'normal',
  range: { low: number | null; high: number | null } = { low: 3.5, high: 5.1 },
): LabResultItem {
  sequence += 1;
  return {
    id: `r-${String(sequence)}`,
    analyte,
    value: numericValue === null ? 'Negative' : String(numericValue),
    numericValue,
    unit: 'mmol/L',
    referenceRange: { ...range, text: '3.5–5.1' },
    flag,
  };
}

function test(id: string, completedDate: string, results: readonly LabResultItem[]): LabTest {
  return {
    id,
    patient: {
      id: 'PT-1',
      name: 'Omar Farouk',
      mrn: 'MRN-1',
      age: 40,
      gender: 'male',
      bloodType: 'O+',
      phone: '01000000000',
    },
    testName: 'Basic metabolic panel',
    testCode: 'BMP',
    category: 'Chemistry',
    department: 'General Medicine',
    orderedBy: 'Dr. Amelia Chen',
    clinicalIndication: 'Routine',
    status: 'completed',
    priority: 'routine',
    requestedDate: completedDate,
    collectedDate: completedDate,
    completedDate,
    specimen: null,
    results,
    interpretation: null,
    hasCriticalResult: false,
    review: null,
    attachments: [],
    annotations: [],
    timeline: [],
    createdAt: completedDate,
    updatedAt: completedDate,
  };
}

const SERIES: readonly LabTest[] = [
  test('LAB-3', '2026-07-01T00:00:00.000Z', [result('Potassium', 5)]),
  test('LAB-1', '2026-05-01T00:00:00.000Z', [result('Potassium', 4.4)]),
  test('LAB-2', '2026-06-01T00:00:00.000Z', [result('Potassium', 4.7), result('Culture', null)]),
];

describe('trendableAnalytes', () => {
  it('lists numeric analytes only, most-measured first, scoped to the patient', () => {
    const other = test('LAB-X', '2026-06-01T00:00:00.000Z', [result('Potassium', 9)]);
    const foreign: LabTest = { ...other, patient: { ...other.patient, id: 'PT-2' } };

    expect(trendableAnalytes([...SERIES, foreign], 'PT-1')).toEqual([
      { analyte: 'Potassium', unit: 'mmol/L', pointCount: 3 },
    ]);
  });
});

describe('buildAnalyteTrend', () => {
  it('orders points oldest first regardless of the input order', () => {
    const trend = buildAnalyteTrend(SERIES, 'PT-1', 'Potassium', 'chart1');
    expect(trend?.points.map((point) => point.value)).toEqual([4.4, 4.7, 5]);
    expect(trend?.points.map((point) => point.labId)).toEqual(['LAB-1', 'LAB-2', 'LAB-3']);
  });

  it('returns null for an analyte this patient has no numeric result for', () => {
    expect(buildAnalyteTrend(SERIES, 'PT-1', 'Culture', 'chart1')).toBeNull();
    expect(buildAnalyteTrend(SERIES, 'PT-2', 'Potassium', 'chart1')).toBeNull();
  });
});

describe('trendBand', () => {
  const potassium = buildAnalyteTrend(SERIES, 'PT-1', 'Potassium', 'chart1');

  it('is the analyte range when one series is selected', () => {
    expect(trendBand([potassium!])).toEqual({
      low: 3.5,
      high: 5.1,
      unit: 'mmol/L',
      text: '3.5–5.1',
    });
  });

  it('disappears when overlaid series do not share one range', () => {
    const sodium: AnalyteTrend = {
      ...potassium!,
      analyte: 'Sodium',
      referenceLow: 135,
      referenceHigh: 145,
    };
    expect(trendBand([potassium!, sodium])).toBeNull();
  });

  it('is null for an analyte with no numeric reference range', () => {
    const qualitative: AnalyteTrend = {
      ...potassium!,
      referenceLow: null,
      referenceHigh: null,
    };
    expect(trendBand([qualitative])).toBeNull();
  });
});

describe('trendDomain', () => {
  const potassium = buildAnalyteTrend(SERIES, 'PT-1', 'Potassium', 'chart1')!;

  it('does NOT anchor at zero — a lab range charted from 0 is unreadable', () => {
    const domain = trendDomain([potassium], trendBand([potassium]));
    expect(domain.min).toBeGreaterThan(0);
    expect(domain.min).toBeLessThan(3.5);
    expect(domain.max).toBeGreaterThan(5.1);
  });

  it('always contains the band, even when every point sits inside it', () => {
    const band = trendBand([potassium]);
    const domain = trendDomain([potassium], band);
    expect(domain.min).toBeLessThanOrEqual(band!.low);
    expect(domain.max).toBeGreaterThanOrEqual(band!.high);
  });

  it('gives a flat series a window rather than a zero-height plot', () => {
    const flat = test('LAB-F', '2026-05-01T00:00:00.000Z', [result('Potassium', 4.2)]);
    const trend = buildAnalyteTrend([flat], 'PT-1', 'Potassium', 'chart1')!;
    const domain = trendDomain([trend], null);
    expect(domain.max).toBeGreaterThan(domain.min);
  });
});

describe('trendTableRows (the P6 view-as-table equivalent)', () => {
  it('is newest first, one row per instant, with a cell per series', () => {
    const potassium = buildAnalyteTrend(SERIES, 'PT-1', 'Potassium', 'chart1')!;
    const rows = trendTableRows([potassium]);
    expect(rows.map((row) => row.labId)).toEqual(['LAB-3', 'LAB-2', 'LAB-1']);
    expect(rows[0]?.cells).toEqual([
      { analyte: 'Potassium', value: 5, flagLabel: 'Normal' },
    ]);
  });

  it('leaves a null cell where a series has no point at that instant', () => {
    const potassium = buildAnalyteTrend(SERIES, 'PT-1', 'Potassium', 'chart1')!;
    const sparse: AnalyteTrend = {
      ...potassium,
      analyte: 'Sodium',
      points: potassium.points.slice(0, 1),
    };
    const rows = trendTableRows([potassium, sparse]);
    expect(rows[0]?.cells[1]).toEqual({ analyte: 'Sodium', value: null, flagLabel: null });
  });
});

describe('series colours', () => {
  it('gives the three overlay slots three distinct chart tones', () => {
    const tones = Array.from({ length: MAX_TREND_SERIES }, (_, index) => toneForSeries(index));
    expect(new Set(tones).size).toBe(MAX_TREND_SERIES);
    // Never an alarm hue: the clinical meaning lives on the point's flag.
    expect(tones.every((tone) => tone.startsWith('chart'))).toBe(true);
  });
});

describe('the seeded dataset gives the trend view something to say', () => {
  it("plots Omar Farouk's potassium rising into the critical value the dashboard names", () => {
    const omar = MOCK_LAB_TESTS.find((entry) =>
      entry.results.some((r) => r.analyte === 'Potassium' && r.flag === 'critical-high'),
    );
    expect(omar).toBeDefined();

    const trend = buildAnalyteTrend(MOCK_LAB_TESTS, omar!.patient.id, 'Potassium', 'chart1');
    expect(trend?.points.map((point) => point.value)).toEqual([4.4, 4.7, 5, 5.6, 6.1]);
    expect(trend?.points.at(-1)?.flag).toBe('critical-high');
  });
});

describe('only released results are history', () => {
  // An order still in the lab can carry values nobody has released; API §8.8
  // serves trends from completed orders only, and the model agrees with it.
  const inLab: LabTest = {
    ...test('LAB-9', '2026-08-01T00:00:00.000Z', [result('Potassium', 7.2, 'critical-high')]),
    status: 'processing',
    completedDate: null,
  };

  it('does not count an unreleased result towards an analyte', () => {
    expect(trendableAnalytes([...SERIES, inLab], 'PT-1')).toEqual([
      { analyte: 'Potassium', unit: 'mmol/L', pointCount: 3 },
    ]);
    expect(trendableAnalytes([inLab], 'PT-1')).toEqual([]);
  });

  it('does not plot an unreleased result', () => {
    const trend = buildAnalyteTrend([...SERIES, inLab], 'PT-1', 'Potassium', 'chart1');
    expect(trend?.points.map((point) => point.labId)).toEqual(['LAB-1', 'LAB-2', 'LAB-3']);
  });
});

describe('trendsFromTests — the mock twin of API §8.8', () => {
  it('answers in the order asked, and names what has nothing to plot', () => {
    const answer = trendsFromTests(SERIES, 'PT-1', ['Sodium', 'Potassium', 'Culture']);

    expect(answer.series.map((series) => series.analyte)).toEqual(['Potassium']);
    expect(answer.empty).toEqual(['Sodium', 'Culture']);
    expect(answer.series[0]?.points.map((point) => point.value)).toEqual([4.4, 4.7, 5]);
    expect(answer.series[0]).not.toHaveProperty('tone');
  });
});
