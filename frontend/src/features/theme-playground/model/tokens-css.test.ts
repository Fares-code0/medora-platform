import { describe, expect, it } from 'vitest';

import { WEB_TOKENS } from './tokens';
import { parseTokensCss } from './tokens-css';

/**
 * A stylesheet in the shape `main`'s palette refactor writes: six primitives on
 * `:root`, brand tokens as `var()` references and `color-mix()`es of them, and
 * a `.dark` block that redeclares some tokens but not the primitives.
 */
const css = (overrides: Record<string, string> = {}, dark: Record<string, string> = {}) => {
  const light: Record<string, string> = {
    'palette-900': '#111522',
    'palette-700': '#303d59',
    'palette-300': '#98a9c4',
    'brand-ink': 'var(--palette-900)',
    ...Object.fromEntries(WEB_TOKENS.map((t) => [t.slice(2), '#ffffff'])),
    'color-primary': 'var(--palette-700)',
    'color-text-primary': 'var(--brand-ink)',
    'color-primary-hover': 'color-mix(in srgb, var(--palette-700) 50%, var(--palette-300))',
    'color-scrim': 'color-mix(in srgb, var(--palette-900) 55%, transparent)',
    ...overrides,
  };
  const decl = (map: Record<string, string>) =>
    Object.entries(map)
      .map(([k, v]) => `  --${k}: ${v};`)
      .join('\n');
  return `/* :root { --color-primary: #000000; } */\n:root {\n${decl(light)}\n}\n\n.dark {\n${decl(dark)}\n}\n`;
};

describe('parseTokensCss resolves tokens to the colour the browser computes', () => {
  it('follows a var() reference, and a reference to a reference', () => {
    const { light } = parseTokensCss(css());
    expect(light['--color-primary']).toBe('#303d59');
    expect(light['--color-text-primary']).toBe('#111522');
  });

  it('evaluates color-mix(in srgb) between two opaque colours per channel', () => {
    // (0x30+0x98)/2 = 0x64, (0x3d+0xa9)/2 = 0x73, (0x59+0xc4)/2 = 142.5 → 0x8f
    expect(parseTokensCss(css()).light['--color-primary-hover']).toBe('#64738f');
  });

  it('mixes with transparent by scaling alpha, keeping the hue', () => {
    expect(parseTokensCss(css()).light['--color-scrim']).toBe('rgba(17, 21, 34, 0.55)');
  });

  it('defaults a missing percentage to the complement, and both missing to 50/50', () => {
    const { light } = parseTokensCss(
      css({
        'color-primary-hover': 'color-mix(in srgb, #000000, #ffffff 25%)',
        'color-primary-pressed': 'color-mix(in srgb, #000000, #ffffff)',
      }),
    );
    expect(light['--color-primary-hover']).toBe('#404040');
    expect(light['--color-primary-pressed']).toBe('#808080');
  });

  it('resolves dark references against .dark over :root, as the cascade does', () => {
    const { light, dark } = parseTokensCss(
      css({}, { 'color-primary': 'var(--palette-300)', 'brand-ink': 'var(--palette-300)' }),
    );
    expect(light['--color-primary']).toBe('#303d59');
    expect(dark['--color-primary']).toBe('#98a9c4');
    // `--color-text-primary` is not redeclared, but its reference is.
    expect(dark['--color-text-primary']).toBe('#98a9c4');
    expect(light['--color-text-primary']).toBe('#111522');
  });

  it('returns literals exactly as written', () => {
    const { dark } = parseTokensCss(
      css({}, { 'color-primary-subtle': 'rgba(143, 180, 224, 0.16)' }),
    );
    expect(dark['--color-primary-subtle']).toBe('rgba(143, 180, 224, 0.16)');
  });

  it('leaves what it cannot evaluate as written, for isValidColor to flag', () => {
    const { light } = parseTokensCss(
      css({
        'color-primary': 'var(--palette-missing)',
        'color-primary-hover': 'color-mix(in oklch, #000000, #ffffff)',
        'color-primary-pressed': 'var(--color-primary-pressed)',
        'color-accent': 'color-mix(in srgb, #000000 30%, #ffffff 30%)',
      }),
    );
    expect(light['--color-primary']).toBe('var(--palette-missing)');
    expect(light['--color-primary-hover']).toBe('color-mix(in oklch, #000000, #ffffff)');
    expect(light['--color-primary-pressed']).toBe('var(--color-primary-pressed)');
    expect(light['--color-accent']).toBe('color-mix(in srgb, #000000 30%, #ffffff 30%)');
  });
});
