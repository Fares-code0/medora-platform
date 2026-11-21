import { describe, expect, it } from 'vitest';

import { computeFloating, FLOATING_GAP, FLOATING_MARGIN, type FloatingInput } from './floating';

/**
 * Which way a dropdown opens, and how tall it may be. The rule: down when it
 * fits below, up when it fits only above, otherwise toward the larger side
 * with its height capped to that side so it scrolls — never pushing the page.
 */

const viewport = { width: 1200, height: 800 };
const at = (top: number, height = 32, left = 100, width = 200) => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
  width,
});
const input = (overrides: Partial<FloatingInput>): FloatingInput => ({
  anchor: at(100),
  viewport,
  contentHeight: 200,
  cap: 320,
  align: 'start',
  matchWidth: false,
  rtl: false,
  ...overrides,
});

describe('vertical placement', () => {
  it('opens downward when the whole menu fits below', () => {
    const g = computeFloating(input({ anchor: at(100) }));
    expect(g.placement).toBe('bottom');
    expect(g.top).toBe(132 + FLOATING_GAP);
    expect(g.bottom).toBeUndefined();
  });

  it('opens upward when it fits only above', () => {
    const g = computeFloating(input({ anchor: at(700) }));
    expect(g.placement).toBe('top');
    expect(g.bottom).toBe(800 - 700 + FLOATING_GAP);
    expect(g.top).toBeUndefined();
  });

  it('does not open upward just because there is more room there, if it fits below', () => {
    const g = computeFloating(input({ anchor: at(500), contentHeight: 200 }));
    // below: 800 - 532 - 4 - 8 = 256 ≥ 200
    expect(g.placement).toBe('bottom');
  });

  it('caps the height to the larger side and lets the content scroll when neither side fits', () => {
    const tight = { width: 400, height: 300 };
    const g = computeFloating(input({ viewport: tight, anchor: at(120), contentHeight: 600 }));
    const below = 300 - 152 - FLOATING_GAP - FLOATING_MARGIN; // 136
    const above = 120 - FLOATING_GAP - FLOATING_MARGIN; // 108
    expect(g.placement).toBe('bottom');
    expect(g.maxHeight).toBe(Math.max(below, above));
  });

  it('never exceeds its design cap', () => {
    const g = computeFloating(input({ contentHeight: 2000, cap: 320 }));
    expect(g.maxHeight).toBe(320);
  });
});

describe('horizontal alignment', () => {
  it('matches the trigger width for a select, pinned to its left edge', () => {
    const g = computeFloating(input({ matchWidth: true }));
    expect(g.width).toBe(200);
    expect(g.left).toBe(100);
  });

  it('aligns end to the trigger’s right edge in a left-to-right page', () => {
    const g = computeFloating(input({ align: 'end' }));
    expect(g.right).toBe(1200 - 300);
    expect(g.left).toBeUndefined();
  });

  it('mirrors in a right-to-left page: end is the left edge', () => {
    const g = computeFloating(input({ align: 'end', rtl: true }));
    expect(g.left).toBe(100);
    const start = computeFloating(input({ align: 'start', rtl: true }));
    expect(start.right).toBe(1200 - 300);
  });

  it('keeps a margin from the viewport edge', () => {
    const g = computeFloating(input({ anchor: at(100, 32, 0, 50) }));
    expect(g.left).toBe(FLOATING_MARGIN);
  });
});
