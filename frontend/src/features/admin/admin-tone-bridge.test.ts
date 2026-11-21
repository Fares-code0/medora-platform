import { describe, expect, it } from 'vitest';

import { ADMIN_TONE_TO_STATISTIC } from './administration.meta';

/**
 * The admin → platform tone bridge (Wave 2d-b).
 *
 * Kept after the `MetricTile` characterization suite was deleted, because the
 * bridge outlived the component it was written for: the 37 migrated tiles now
 * pass `StatisticTone` values, and this map is what makes that translation a
 * decision rather than a coincidence of two scales sharing most of their
 * names.
 *
 * It lives on the admin side deliberately — the platform layer has no
 * business knowing this area calls the accent `accent`.
 */
describe('ADMIN_TONE_TO_STATISTIC', () => {
  it('maps every admin tone onto a platform tone, sending accent to ai', () => {
    expect(ADMIN_TONE_TO_STATISTIC).toEqual({
      primary: 'primary',
      secondary: 'secondary',
      success: 'success',
      warning: 'warning',
      error: 'error',
      info: 'info',
      accent: 'ai',
    });
  });

  it('covers the whole admin Tone scale', () => {
    // A tone added to the admin scale with no platform counterpart would
    // otherwise surface as a silently wrong chip.
    expect(Object.keys(ADMIN_TONE_TO_STATISTIC).sort()).toEqual(
      ['accent', 'error', 'info', 'primary', 'secondary', 'success', 'warning'].sort(),
    );
  });

  it('renames only the accent — every other tone keeps its name', () => {
    const renamed = Object.entries(ADMIN_TONE_TO_STATISTIC).filter(([from, to]) => from !== to);
    expect(renamed).toEqual([['accent', 'ai']]);
  });
});
