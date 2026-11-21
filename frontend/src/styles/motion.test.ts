import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EASE_OUT, motionTokens, staggerDelay } from './motion';

/**
 * motion.ts claims its values mirror the custom properties in tokens.css so the
 * two "cannot drift apart". Nothing enforced that claim, which made it a comment
 * rather than a guarantee — this file is the enforcement.
 *
 * Durations are seconds in TS (Framer Motion's unit) and milliseconds in CSS,
 * so the comparison converts rather than matching text.
 */
// Vitest runs with `frontend/` as its root, so resolve from cwd — under jsdom
// `import.meta.url` is not a file: URL and cannot be converted to a path.
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function cssMs(name: string): number {
  const match = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)ms`).exec(tokensCss);
  if (!match?.[1]) throw new Error(`tokens.css defines no --${name}`);
  return Number(match[1]);
}

function cssCubicBezier(name: string): number[] {
  const match = new RegExp(`--${name}:\\s*cubic-bezier\\(([^)]+)\\)`).exec(tokensCss);
  if (!match?.[1]) throw new Error(`tokens.css defines no --${name}`);
  return match[1].split(',').map((part) => Number(part.trim()));
}

describe('motion tokens mirror tokens.css', () => {
  it.each([
    ['duration-fast', motionTokens.duration.fast],
    ['duration-base', motionTokens.duration.base],
    ['duration-moderate', motionTokens.duration.moderate],
    ['duration-slow', motionTokens.duration.slow],
    ['duration-entrance', motionTokens.duration.entrance],
  ])('--%s matches the TS value', (cssName, seconds) => {
    expect(cssMs(cssName)).toBe(Math.round(seconds * 1000));
  });

  it('--motion-stagger matches the TS stagger', () => {
    expect(cssMs('motion-stagger')).toBe(Math.round(motionTokens.stagger * 1000));
  });

  it('--ease-out matches EASE_OUT', () => {
    expect(cssCubicBezier('ease-out')).toEqual(EASE_OUT);
  });
});

describe('stagger policy', () => {
  it('resolves the 30ms vs 40-60ms conflict at the brief midpoint', () => {
    expect(motionTokens.stagger).toBe(0.05);
  });

  it('keeps the whole entrance inside the 300-500ms band at the cap', () => {
    // Last item starts at the capped delay, then takes one duration to settle.
    const total = staggerDelay(motionTokens.staggerCap) + motionTokens.duration.moderate;
    expect(total).toBeCloseTo(0.6);
  });
});
