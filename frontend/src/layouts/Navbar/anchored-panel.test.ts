import { describe, expect, it } from 'vitest';

import {
  PANEL_EDGE,
  PANEL_GAP,
  PANEL_MAX_WIDTH,
  computeAnchoredPanel,
  type TriggerRect,
} from './anchored-panel';

function bell(left: number, top = 6, size = 40): TriggerRect {
  return { top, bottom: top + size, left, right: left + size, width: size };
}

describe('computeAnchoredPanel', () => {
  it('hangs beneath the trigger, its end edge flush with the trigger on desktop', () => {
    const trigger = bell(1340);
    const position = computeAnchoredPanel(trigger, 1440, false);

    expect(position.top).toBe(trigger.bottom + PANEL_GAP);
    expect(position.width).toBe(PANEL_MAX_WIDTH);
    expect(position.left + position.width).toBe(trigger.right);
    // The caret points at the bell's centre.
    expect(position.left + position.caretX).toBe(trigger.left + trigger.width / 2);
  });

  it('opens towards the reading end in RTL, from the trigger’s left edge', () => {
    const trigger = bell(60);
    const position = computeAnchoredPanel(trigger, 1440, true);

    expect(position.left).toBe(trigger.left);
    expect(position.left + position.caretX).toBe(trigger.left + trigger.width / 2);
  });

  it('shrinks to the viewport and stays inside it on a phone', () => {
    const viewport = 360;
    const trigger = bell(272);
    const position = computeAnchoredPanel(trigger, viewport, false);

    expect(position.width).toBe(viewport - PANEL_EDGE * 2);
    expect(position.left).toBeGreaterThanOrEqual(PANEL_EDGE);
    expect(position.left + position.width).toBeLessThanOrEqual(viewport - PANEL_EDGE);
    // Still pointing at the bell even though the panel had to slide.
    expect(position.left + position.caretX).toBe(trigger.left + trigger.width / 2);
  });

  it('never lets the panel cross the far edge when the trigger is near it', () => {
    const position = computeAnchoredPanel(bell(4), 1024, false);

    expect(position.left).toBe(PANEL_EDGE);
    expect(position.caretX).toBeGreaterThan(0);
    expect(position.caretX).toBeLessThan(position.width);
  });
});
