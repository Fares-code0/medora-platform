import { describe, expect, it } from 'vitest';

import type { LabTest } from '../model/types';

import { labRowClassName } from './lab-row-tint';

/**
 * The critical tint has to reach a pinned first cell as well as the row
 * (DEC-015): the row paints `bg-error-subtle`, and the pinned cell rebuilds
 * the same colour from `--row-bg` over an opaque surface. A tint that set
 * only one of the two would leave the patient's name a different colour from
 * the rest of a critical row.
 */
function test_(
  review: LabTest['review'],
  flag: string,
  status: LabTest['status'] = 'completed',
): LabTest {
  return { review, status, results: [{ flag }] } as unknown as LabTest;
}

describe('labRowClassName', () => {
  it('tints an unreviewed critical result, row and pinned cell alike', () => {
    const classes = labRowClassName(test_(null, 'critical-high'))?.split(' ') ?? [];
    expect(classes).toContain('bg-error-subtle');
    expect(classes).toContain('[--row-bg:var(--color-error-subtle)]');
  });

  it('leaves a reviewed critical result, and a normal one, untinted', () => {
    expect(labRowClassName(test_({} as LabTest['review'], 'critical-high'))).toBeUndefined();
    expect(labRowClassName(test_(null, 'normal'))).toBeUndefined();
  });

  it('leaves a provisional critical value on a processing order untinted (§31)', () => {
    expect(labRowClassName(test_(null, 'critical-high', 'processing'))).toBeUndefined();
  });
});
