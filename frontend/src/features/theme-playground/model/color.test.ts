import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  formatColor,
  hexOf,
  hueDistance,
  mixSrgb,
  parseColor,
  suggestAccessible,
  withHexKeepingAlpha,
} from './color';
import { checkPalette } from './contrast-rules';
import { buildPresets } from './presets';

const PRESETS = buildPresets(readFileSync(join(__dirname, '../../../styles/tokens.css'), 'utf8'));
const original = PRESETS[0]!;

describe('parseColor', () => {
  it('reads every form tokens.css uses', () => {
    expect(parseColor('#2c5282')).toStrictEqual({ r: 44, g: 82, b: 130, a: 1 });
    expect(parseColor('#fff')).toStrictEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(143, 180, 224, 0.16)')).toStrictEqual({ r: 143, g: 180, b: 224, a: 0.16 });
    expect(parseColor('transparent')?.a).toBe(0);
  });

  it('rejects what is not a colour', () => {
    expect(parseColor('blue-ish')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('rgb(300, 0, 0)')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('matches the published WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('agrees with the ratio tokens.css documents for text-tertiary (6.11:1 on surface)', () => {
    expect(contrastRatio('#576373', '#ffffff')).toBeCloseTo(6.11, 1);
  });

  it('composites a translucent ground over its base before measuring', () => {
    // 16% primary over the dark surface is nearly the surface itself.
    const onTint = contrastRatio('#8fb4e0', 'rgba(143, 180, 224, 0.16)', '#1b1b1e');
    const onSurface = contrastRatio('#8fb4e0', '#1b1b1e');
    expect(onTint).not.toBeNull();
    expect(onTint!).toBeLessThan(onSurface!);
    expect(onTint!).toBeGreaterThan(4.5);
  });
});

describe('alpha-preserving edits', () => {
  it('keeps a subtle token translucent when its hue is picked', () => {
    expect(withHexKeepingAlpha('rgba(143, 180, 224, 0.16)', '#ff0000')).toBe('rgba(255, 0, 0, 0.16)');
    expect(withHexKeepingAlpha('#2c5282', '#0b5cad')).toBe('#0b5cad');
  });

  it('round-trips through formatColor', () => {
    expect(formatColor(parseColor('#0b5cad')!)).toBe('#0b5cad');
    expect(hexOf('rgba(1, 2, 3, 0.5)')).toBe('#010203');
  });
});

describe('suggestAccessible', () => {
  it('finds a passing value and never returns a failing one', () => {
    const suggestion = suggestAccessible('#9aa3b0', '#ffffff', 4.5);
    expect(suggestion).not.toBeNull();
    expect(contrastRatio(suggestion!.color, '#ffffff')!).toBeGreaterThanOrEqual(4.5);
  });

  it('moves lighter on a dark ground', () => {
    const suggestion = suggestAccessible('#3a3a40', '#0d0d0f', 4.5);
    expect(contrastRatio(suggestion!.color, '#0d0d0f')!).toBeGreaterThanOrEqual(4.5);
  });
});

describe('hueDistance', () => {
  it('wraps around the colour wheel', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 190)).toBe(180);
  });
});

describe('checkPalette', () => {
  it('reports a real failure with its ratio, its tokens and a suggestion', () => {
    const broken = { ...original.light, '--color-text-tertiary': '#c8ccd2' };
    const finding = checkPalette(broken).find((f) => f.id === '--color-text-tertiary/--color-surface');
    expect(finding?.severity).toBe('fail');
    expect(finding?.tokens).toStrictEqual(['--color-text-tertiary', '--color-surface']);
    expect(finding?.ratio).toBeLessThan(4.5);
    expect(contrastRatio(finding!.suggestion!, broken['--color-surface'])!).toBeGreaterThanOrEqual(4.5);
  });

  it('catches the white-on-light filled button the dark theme was designed against', () => {
    const broken = { ...original.dark, '--color-text-inverse': '#ffffff' };
    expect(checkPalette(broken).some((f) => f.id === '--color-text-inverse/--color-primary')).toBe(true);
  });

  it('warns when the AI accent drifts onto the brand hue', () => {
    const broken = { ...original.light, '--color-accent': '#2f5a8a' };
    expect(checkPalette(broken).some((f) => f.id === 'hue:--color-accent/--color-primary')).toBe(true);
  });

  it('flags an invalid colour instead of measuring it', () => {
    const broken = { ...original.light, '--color-surface': 'not-a-colour' };
    expect(checkPalette(broken).some((f) => f.message.includes('not a valid colour'))).toBe(true);
  });
});

describe('mixSrgb', () => {
  it('is the plain per-channel mix for two opaque colours', () => {
    expect(formatColor(mixSrgb(parseColor('#000000')!, parseColor('#ffffff')!, 0.25))).toBe('#bfbfbf');
    expect(formatColor(mixSrgb(parseColor('#303d59')!, parseColor('#303d59')!, 0.4))).toBe('#303d59');
  });

  it('premultiplies alpha, so mixing with transparent keeps the hue', () => {
    expect(formatColor(mixSrgb(parseColor('#111522')!, parseColor('transparent')!, 0.72))).toBe(
      'rgba(17, 21, 34, 0.72)',
    );
  });

  it('clamps the weight to 0–1', () => {
    expect(formatColor(mixSrgb(parseColor('#000000')!, parseColor('#ffffff')!, 2))).toBe('#000000');
  });
});
