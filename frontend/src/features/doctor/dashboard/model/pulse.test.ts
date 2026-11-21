import { describe, expect, it } from 'vitest';

import { MIN_COMPARABLE_APPOINTMENTS, noShowRateStatistic } from './pulse';

/**
 * Practice pulse's no-show rate. The counts are the server's; what is
 * decided here is how a rate is worded, when it is withheld and when a
 * comparison is too thin to draw.
 */
describe('noShowRateStatistic', () => {
  const steady = { noShows: 2, appointments: 50 };

  it('words the rate to one decimal, with its denominator as the caption', () => {
    expect(noShowRateStatistic({ noShows: 3, appointments: 72 }, steady)).toMatchObject({
      id: 'no-show-rate',
      label: 'No-show rate (30d)',
      value: '4.2%',
      caption: '3 of 72 appointments',
    });
  });

  it('shows no rate for an empty window, and says why', () => {
    const statistic = noShowRateStatistic({ noShows: 0, appointments: 0 }, steady);

    expect(statistic).toEqual({
      id: 'no-show-rate',
      label: 'No-show rate (30d)',
      value: '—',
      caption: 'No appointments in the last 30 days',
    });
  });

  it('shows a zero rate as a measured 0.0%, not as missing', () => {
    expect(noShowRateStatistic({ noShows: 0, appointments: 40 }, steady).value).toBe('0.0%');
  });

  it('says "appointment" for a denominator of one', () => {
    expect(noShowRateStatistic({ noShows: 1, appointments: 1 }, steady).caption).toBe(
      '1 of 1 appointment',
    );
  });

  it('compares in percentage points, a rise being the bad direction', () => {
    // 6 / 100 = 6.0% against 4 / 100 = 4.0%: up 2.0 points, not "50%".
    expect(
      noShowRateStatistic({ noShows: 6, appointments: 100 }, { noShows: 4, appointments: 100 })
        .delta,
    ).toEqual({
      direction: 'up',
      label: '2.0 pts',
      tone: 'negative',
      comparison: 'vs previous 30 days',
    });
  });

  it('words a fall as good and an unchanged rate as neutral', () => {
    expect(
      noShowRateStatistic({ noShows: 1, appointments: 100 }, { noShows: 3, appointments: 100 })
        .delta,
    ).toMatchObject({ direction: 'down', label: '2.0 pts', tone: 'positive' });
    expect(
      noShowRateStatistic({ noShows: 2, appointments: 40 }, { noShows: 1, appointments: 20 }).delta,
    ).toMatchObject({ direction: 'flat', label: '0.0 pts', tone: 'neutral' });
  });

  it('subtracts the rounded rates exactly, so the chip matches the figures shown', () => {
    // 1 / 30 = 3.3% and 1 / 70 = 1.4%: the chip says 1.9, not 1.9047….
    expect(
      noShowRateStatistic({ noShows: 1, appointments: 30 }, { noShows: 1, appointments: 70 }).delta
        ?.label,
    ).toBe('1.9 pts');
  });

  it.each([
    ['this window', { noShows: 1, appointments: MIN_COMPARABLE_APPOINTMENTS - 1 }, steady],
    ['the window before', steady, { noShows: 0, appointments: MIN_COMPARABLE_APPOINTMENTS - 1 }],
    ['the window before, empty', steady, { noShows: 0, appointments: 0 }],
  ])('draws no comparison when %s is too small to compare', (_, current, prior) => {
    const statistic = noShowRateStatistic(current, prior);

    expect(statistic.delta).toBeUndefined();
    // The rate itself is still shown.
    expect(statistic.value).toMatch(/%$/);
  });

  it('compares from exactly the minimum sample upward', () => {
    const atMinimum = { noShows: 1, appointments: MIN_COMPARABLE_APPOINTMENTS };

    expect(noShowRateStatistic(atMinimum, atMinimum).delta).toBeDefined();
  });
});
