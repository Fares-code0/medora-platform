import { describe, expect, it } from 'vitest';

import {
  flagForNumeric,
  flagForQualitative,
  formatValue,
  isAbnormalFlag,
  isCriticalFlag,
  isOfferedOption,
  isQualitative,
  referenceTextFor,
  sameOption,
  type AnalyteBounds,
} from './result-grading';

/**
 * The grading ladder (RM M14.4 — API §8.6).
 *
 * These are the assertions that decide whether a doctor is called about
 * a potassium today or reads about it next week, so the boundaries get
 * their own cases rather than being covered incidentally by a value in
 * the middle of a band.
 *
 * The fixtures are the **seeded** specs (`prisma/seed/catalogues.ts`),
 * not invented numbers: potassium 3.5–5.1 with criticals at 2.5 and 6.0,
 * and TSH 0.4–4 with a `criticalHigh` of 50 and no `criticalLow`. Using
 * the real catalogue means a change to the seed that contradicts these
 * rules fails here rather than in production.
 */

/** Basic Metabolic Panel → Potassium, verbatim from the seed. */
const POTASSIUM: AnalyteBounds = {
  refLow: 3.5,
  refHigh: 5.1,
  criticalLow: 2.5,
  criticalHigh: 6.0,
  decimals: 1,
  qualitativeOptions: [],
};

/** Thyroid Panel → TSH: a critical high and deliberately no critical low. */
const TSH: AnalyteBounds = {
  refLow: 0.4,
  refHigh: 4,
  criticalLow: null,
  criticalHigh: 50,
  decimals: 2,
  qualitativeOptions: [],
};

/** No spec in the seed is qualitative; this is the shape M5.5 permits. */
const CULTURE: AnalyteBounds = {
  refLow: null,
  refHigh: null,
  criticalLow: null,
  criticalHigh: null,
  decimals: 0,
  qualitativeOptions: ['No growth', 'Mixed flora', 'Isolated organism'],
};

describe('flagForNumeric — the ladder', () => {
  it('grades a value inside the reference interval as normal', () => {
    expect(flagForNumeric(4.2, POTASSIUM)).toBe('NORMAL');
  });

  it('treats the reference interval as inclusive at both ends', () => {
    // A reference *interval* includes its endpoints — `flagForValue` in
    // the frontend's corpus is `value < low` / `value > high`, and a
    // patient whose potassium is exactly 5.1 does not have a high one.
    expect(flagForNumeric(3.5, POTASSIUM)).toBe('NORMAL');
    expect(flagForNumeric(5.1, POTASSIUM)).toBe('NORMAL');
  });

  it('grades just outside the interval as low or high, not critical', () => {
    expect(flagForNumeric(3.4, POTASSIUM)).toBe('LOW');
    expect(flagForNumeric(5.2, POTASSIUM)).toBe('HIGH');
  });

  it('treats the critical thresholds as inclusive', () => {
    // A threshold a result may sit on without raising the alert is a
    // threshold one unit higher than the one that was written down.
    expect(flagForNumeric(2.5, POTASSIUM)).toBe('CRITICAL_LOW');
    expect(flagForNumeric(6.0, POTASSIUM)).toBe('CRITICAL_HIGH');
  });

  it('grades beyond the critical thresholds as critical', () => {
    expect(flagForNumeric(1.9, POTASSIUM)).toBe('CRITICAL_LOW');
    expect(flagForNumeric(7.2, POTASSIUM)).toBe('CRITICAL_HIGH');
  });

  it('tests critical before the reference bounds', () => {
    // Every critical value is also out of range (`critical_low < ref_low`
    // is a CHECK), so a ladder that tested `low` first would grade every
    // critical result as merely low — and merely low is bulk-reviewable
    // nowhere, but it is not the thing that gets a phone call.
    const flag = flagForNumeric(1.0, POTASSIUM);
    expect(flag).toBe('CRITICAL_LOW');
    expect(isCriticalFlag(flag)).toBe(true);
  });

  it('abstains on a bound that is null rather than failing the value', () => {
    // TSH has no `criticalLow`: a suppressed TSH is not the emergency an
    // extremely high one is. A one-sided spec is a real spec.
    expect(flagForNumeric(0.01, TSH)).toBe('LOW');
    expect(flagForNumeric(0, TSH)).toBe('LOW');
    expect(flagForNumeric(60, TSH)).toBe('CRITICAL_HIGH');
  });

  it('grades a negative value against the same ladder', () => {
    // Nothing in the ladder assumes a positive scale — base excess and
    // temperature deltas are legitimately negative.
    const excess: AnalyteBounds = {
      refLow: -2,
      refHigh: 2,
      criticalLow: -10,
      criticalHigh: 10,
      decimals: 1,
      qualitativeOptions: [],
    };

    expect(flagForNumeric(-1, excess)).toBe('NORMAL');
    expect(flagForNumeric(-5, excess)).toBe('LOW');
    expect(flagForNumeric(-12, excess)).toBe('CRITICAL_LOW');
  });
});

describe('flagForQualitative', () => {
  it('grades the first option as normal — the AnalyteSpec convention', () => {
    expect(flagForQualitative('No growth', CULTURE)).toBe('NORMAL');
  });

  it('grades every other offered option as abnormal', () => {
    expect(flagForQualitative('Mixed flora', CULTURE)).toBe('ABNORMAL');
    expect(flagForQualitative('Isolated organism', CULTURE)).toBe('ABNORMAL');
  });

  it('never grades a qualitative result critical', () => {
    // PD-14.4. `lab_results_numeric_flag_needs_value` is
    // `flag IN ('normal','abnormal') OR value_numeric IS NOT NULL`, so a
    // qualitative result — which has no numeric value by definition —
    // cannot carry `critical-high` at all. The frontend corpus's regex
    // over option text (`/…|isolated|…/i`) would produce exactly that
    // for "Isolated organism", and the database would refuse the row.
    for (const option of CULTURE.qualitativeOptions) {
      expect(isCriticalFlag(flagForQualitative(option, CULTURE))).toBe(false);
    }
  });

  it('is case- and whitespace-insensitive, and nothing more', () => {
    expect(flagForQualitative('  no growth ', CULTURE)).toBe('NORMAL');
    // Not a substring match: "growth" alone is not "No growth", and
    // reading an unrecognised answer as normal is the fail-open this
    // module exists to avoid.
    expect(flagForQualitative('growth', CULTURE)).toBe('ABNORMAL');
  });

  it('reports abnormal rather than normal when no options are offered', () => {
    expect(flagForQualitative('anything', { ...CULTURE, qualitativeOptions: [] })).toBe(
      'ABNORMAL',
    );
  });
});

describe('isQualitative and isOfferedOption', () => {
  it('splits numeric from qualitative on the presence of a range', () => {
    expect(isQualitative(POTASSIUM)).toBe(false);
    expect(isQualitative(CULTURE)).toBe(true);
  });

  it('recognises an offered option however it is cased', () => {
    expect(isOfferedOption('MIXED FLORA', CULTURE)).toBe(true);
    expect(isOfferedOption('Negtive', CULTURE)).toBe(false);
  });

  it('compares options trimmed and case-insensitively', () => {
    expect(sameOption(' Negative ', 'negative')).toBe(true);
    expect(sameOption('Negative', 'Positive')).toBe(false);
  });
});

describe('isCriticalFlag and isAbnormalFlag', () => {
  it('names exactly the two flags the M5.10 trigger names', () => {
    expect(isCriticalFlag('CRITICAL_LOW')).toBe(true);
    expect(isCriticalFlag('CRITICAL_HIGH')).toBe(true);
    expect(isCriticalFlag('HIGH')).toBe(false);
    expect(isCriticalFlag('ABNORMAL')).toBe(false);
    expect(isCriticalFlag('NORMAL')).toBe(false);
  });

  it('treats anything but normal as abnormal — the bulk-review gate', () => {
    // "Bulk allowed only for Normal" means normal, not non-critical: a
    // merely high potassium is a result a doctor should have looked at.
    expect(isAbnormalFlag('HIGH')).toBe(true);
    expect(isAbnormalFlag('ABNORMAL')).toBe(true);
    expect(isAbnormalFlag('CRITICAL_LOW')).toBe(true);
    expect(isAbnormalFlag('NORMAL')).toBe(false);
  });
});

describe('referenceTextFor', () => {
  it('words a two-sided range at the analyte precision, en dash', () => {
    // `referenceText` in the frontend's corpus, verbatim — the same
    // wording has to appear on the order form and beside the result.
    expect(referenceTextFor(POTASSIUM)).toBe('3.5–5.1');
    expect(referenceTextFor(TSH)).toBe('0.40–4.00');
  });

  it('states a one-sided range rather than inventing the other end', () => {
    expect(referenceTextFor({ ...POTASSIUM, refHigh: null })).toBe('≥ 3.5');
    expect(referenceTextFor({ ...POTASSIUM, refLow: null })).toBe('≤ 5.1');
  });

  it('uses the normal option for a qualitative analyte', () => {
    expect(referenceTextFor(CULTURE)).toBe('No growth');
  });

  it('falls back to "See report" when there is neither', () => {
    expect(referenceTextFor({ ...CULTURE, qualitativeOptions: [] })).toBe('See report');
  });
});

describe('formatValue', () => {
  it('renders at the analyte own precision', () => {
    expect(formatValue(5, 1)).toBe('5.0');
    expect(formatValue(5.146, 2)).toBe('5.15');
    expect(formatValue(5.4, 0)).toBe('5');
  });

  it('clamps a precision the column could not hold rather than throwing', () => {
    // `toFixed` throws a RangeError outside 0–100 and `decimals` is a
    // nullable SmallInt. The M5.5 CHECK holds it to 0–3, but a
    // projection that can throw on a row the database considers valid is
    // a 500 waiting for the one row that predates the constraint.
    expect(formatValue(5.12345, 99)).toBe('5.123');
    expect(formatValue(5.12345, -4)).toBe('5');
    expect(formatValue(5.12345, Number.NaN)).toBe('5');
  });
});
