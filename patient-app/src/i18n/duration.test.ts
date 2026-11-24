import { arabicResultCount, formatMinutes } from './duration';

/**
 * The one message in the tree that needs a count agreeing with a noun
 * (C-09, D-12/T-11). `duration.ts` explains why it is four cases in
 * Arabic and two in English; this asserts all six, because a rule
 * written in a docblock and not in a test is a rule that gets simplified
 * back to "n === 1" by the next person who reads it quickly.
 */
describe('English', () => {
  it('uses the singular at one and the plural above it', () => {
    expect(formatMinutes('en', 60_000)).toBe('1 minute');
    expect(formatMinutes('en', 2 * 60_000)).toBe('2 minutes');
    expect(formatMinutes('en', 15 * 60_000)).toBe('15 minutes');
  });
});

describe('Arabic', () => {
  it('uses the singular, the dual, the paucal and the numeral form', () => {
    expect(formatMinutes('ar', 60_000)).toBe('دقيقة واحدة');
    expect(formatMinutes('ar', 2 * 60_000)).toBe('دقيقتان');
    expect(formatMinutes('ar', 5 * 60_000)).toBe('5 دقائق');
    expect(formatMinutes('ar', 30 * 60_000)).toBe('30 دقيقة');
  });

  it('changes form at the 10/11 boundary, which English does not have', () => {
    expect(formatMinutes('ar', 10 * 60_000)).toBe('10 دقائق');
    expect(formatMinutes('ar', 11 * 60_000)).toBe('11 دقيقة');
  });
});

describe('both', () => {
  it('never says zero — a timeout of no length explains nothing', () => {
    expect(formatMinutes('en', 0)).toBe('1 minute');
    expect(formatMinutes('en', 1)).toBe('1 minute');
    expect(formatMinutes('ar', 0)).toBe('دقيقة واحدة');
  });
});

describe('a lab order’s result count in Arabic (review L-9)', () => {
  it('uses the singular, dual, paucal and the singular after 11', () => {
    expect(arabicResultCount(1)).toBe('نتيجة واحدة');
    expect(arabicResultCount(2)).toBe('نتيجتان');
    expect(arabicResultCount(3)).toBe('3 نتائج');
    expect(arabicResultCount(10)).toBe('10 نتائج');
    expect(arabicResultCount(11)).toBe('11 نتيجة');
    expect(arabicResultCount(100)).toBe('100 نتيجة');
    expect(arabicResultCount(103)).toBe('103 نتائج');
  });
});
