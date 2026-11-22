import { describe, expect, it } from 'vitest';

import {
  computeFloating,
  FLOATING_GAP,
  FLOATING_MARGIN,
  isAnchorHidden,
  VIEWPORT_HEIGHT_RATIO,
  type FloatingInput,
} from './floating';

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

describe('phone viewports', () => {
  const phone = { width: 375, height: 667 };

  it('flips upward for a trigger near the bottom of a phone screen', () => {
    const g = computeFloating(
      input({ viewport: phone, anchor: at(600, 32, 300, 40), contentHeight: 240, align: 'end' }),
    );
    expect(g.placement).toBe('top');
    expect(g.bottom).toBe(667 - 600 + FLOATING_GAP);
    expect(g.maxHeight).toBeGreaterThanOrEqual(240);
  });

  it('caps a long menu at 60% of a short viewport, below the design cap', () => {
    const short = { width: 375, height: 400 };
    const g = computeFloating(
      input({ viewport: short, anchor: at(10), contentHeight: 2000, cap: 400 }),
    );
    expect(g.maxHeight).toBe(Math.floor(400 * VIEWPORT_HEIGHT_RATIO));
    expect(g.maxHeight).toBeLessThanOrEqual(400 - 42 - FLOATING_GAP - FLOATING_MARGIN);
  });

  it('clamps an end-aligned menu inside a 320px-wide screen on both sides', () => {
    const narrow = { width: 320, height: 640 };
    // Trigger hugging the left edge: an end-aligned 240px menu would hang off the left.
    const g = computeFloating(
      input({ viewport: narrow, anchor: at(100, 32, 4, 40), contentWidth: 240, align: 'end' }),
    );
    expect(g.maxWidth).toBe(320 - 2 * FLOATING_MARGIN);
    const rightEdge = 320 - (g.right ?? 0);
    expect(rightEdge - 240).toBeGreaterThanOrEqual(FLOATING_MARGIN);
    expect(rightEdge).toBeLessThanOrEqual(320 - FLOATING_MARGIN);
  });

  it('clamps a start-aligned menu so its right edge stays on a 320px screen', () => {
    const narrow = { width: 320, height: 640 };
    const g = computeFloating(
      input({ viewport: narrow, anchor: at(100, 32, 280, 32), contentWidth: 200 }),
    );
    expect(g.left).toBe(320 - FLOATING_MARGIN - 200);
  });

  it('caps a too-wide menu to the screen width', () => {
    const narrow = { width: 320, height: 640 };
    const g = computeFloating(
      input({ viewport: narrow, anchor: at(100, 32, 0, 32), contentWidth: 500 }),
    );
    expect(g.left).toBe(FLOATING_MARGIN);
    expect(g.maxWidth).toBe(304);
  });

  it('measures against the visual viewport (on-screen keyboard open)', () => {
    // Layout viewport 800 tall; only 400px visible, scrolled 200px down.
    const g = computeFloating(
      input({
        viewport: { width: 375, height: 400, offsetTop: 200, layoutWidth: 375, layoutHeight: 800 },
        anchor: at(520, 32),
        contentHeight: 200,
      }),
    );
    // Below: 600 - 8 - 556 = 36 → too little; above: 516 - 208 = 308.
    expect(g.placement).toBe('top');
    expect(g.bottom).toBe(800 - (520 - FLOATING_GAP));
  });
});

describe('isAnchorHidden', () => {
  const view = { top: 0, bottom: 800, left: 0, right: 1200, width: 1200 };

  it('is visible while any part of it is on screen', () => {
    expect(isAnchorHidden(at(-20), [view])).toBe(false);
  });

  it('is hidden once scrolled fully above the viewport', () => {
    expect(isAnchorHidden(at(-40), [view])).toBe(true);
  });

  it('is hidden once scrolled out of a clipping scroller', () => {
    const scroller = { top: 64, bottom: 800, left: 0, right: 1200, width: 1200 };
    expect(isAnchorHidden(at(20), [view, scroller])).toBe(true);
  });
});

describe('isAnchorHidden — zero-area clip boxes', () => {
  it('ignores a clipping ancestor with no area (display: contents, not laid out)', () => {
    const anchor = { top: 100, bottom: 132, left: 10, right: 42, width: 32, height: 32 };
    const empty = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    expect(isAnchorHidden(anchor, [empty])).toBe(false);
    // A real clip that excludes the trigger still hides it.
    expect(isAnchorHidden(anchor, [empty, { top: 200, bottom: 400, left: 0, right: 320, width: 320, height: 200 }])).toBe(true);
  });
});
