import { describe, expect, it } from 'vitest';

import { BG_SOLID, ORDERED_TONES, TONE_CLASSES, toneAt } from './palette';
import type { AnalyticsTone, ChartTone, SemanticTone } from './types';

/**
 * Chart palette invariants — ADR-0001 §9.
 *
 * The defect these lock down: `ORDERED_TONES` used to sequence all seven
 * semantic tones, so a chart auto-assigning colours by list position made its
 * second category success-green, its fourth warning-amber and its seventh
 * error-red. A specialty mix rendered Orthopaedics as a warning and
 * Paediatrics in the colour reserved for AI-generated content.
 *
 * These are assertions about MEANING, not about specific hex values, so they
 * keep holding if the ramp is ever re-toned.
 */

const SEMANTIC: readonly SemanticTone[] = [
  'primary',
  'secondary',
  'accent',
  'success',
  'warning',
  'info',
  'error',
];

/** The four whose colour is an alarm, plus the AI-provenance accent. */
const RESERVED: readonly SemanticTone[] = ['success', 'warning', 'error', 'info', 'accent'];

const CHART: readonly ChartTone[] = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'];

describe('auto-assigned chart colours', () => {
  it('never reaches a clinical or AI tone, at any index', () => {
    // Well past the ramp length, so the modulo wrap is covered too.
    for (let i = 0; i < 50; i++) {
      const tone: AnalyticsTone = toneAt(i);
      expect(RESERVED).not.toContain(tone);
      expect(CHART).toContain(tone);
    }
  });

  it('offers only categorical slots to choose from', () => {
    expect([...ORDERED_TONES]).toStrictEqual([...CHART]);
  });

  it('cycles through every slot before repeating', () => {
    const firstPass = CHART.map((_, i) => toneAt(i));
    expect(new Set(firstPass).size).toBe(CHART.length);
    expect(toneAt(CHART.length)).toBe(toneAt(0));
  });
});

describe('tone class maps', () => {
  const all: readonly AnalyticsTone[] = [...CHART, ...SEMANTIC];

  it('covers every tone in both maps', () => {
    for (const tone of all) {
      expect(TONE_CLASSES[tone]).toBeDefined();
      expect(BG_SOLID[tone]).toBeTruthy();
    }
  });

  it('gives every chart slot a darker same-hue edge, not a surface separator', () => {
    // The edge is what holds the pale slots (4 and 5) to 3:1 against the
    // surface — a chart slot falling back to `stroke-surface` would erase it.
    for (const tone of CHART) {
      const { edge, ring } = TONE_CLASSES[tone];
      expect(edge).toMatch(/^stroke-chart-\d-edge$/);
      expect(ring).toMatch(/^ring-chart-\d-edge$/);
      expect(edge).not.toBe('stroke-surface');
    }
  });

  it('gives every semantic tone the surface separator instead', () => {
    // These have no darker variant and clear 4.5:1 unaided, so their outline's
    // only job is telling one slice from its neighbour.
    for (const tone of SEMANTIC) {
      expect(TONE_CLASSES[tone].edge).toBe('stroke-surface');
    }
  });

  it('keeps `stroke` as the tone colour for lines, distinct from `edge`', () => {
    // LineAreaChart draws the line with `stroke`. If a semantic tone's stroke
    // ever became the separator, a semantic line would render white-on-white.
    for (const tone of SEMANTIC) {
      expect(TONE_CLASSES[tone].stroke).toBe(`stroke-${tone}`);
      expect(TONE_CLASSES[tone].stroke).not.toBe(TONE_CLASSES[tone].edge);
    }
  });

  it('never points a chart slot at a semantic colour token', () => {
    for (const tone of CHART) {
      const classes = Object.values(TONE_CLASSES[tone]).join(' ');
      for (const reserved of RESERVED) {
        expect(classes).not.toMatch(new RegExp(`-${reserved}\\b`));
      }
    }
  });
});
