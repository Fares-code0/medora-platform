import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, isValidColor } from './color';
import { checkPalette } from './contrast-rules';
import { buildPresets } from './presets';
import { COPIED_TOKEN_NAMES, COPIED_TOKENS, WEB_TOKENS } from './tokens';
import { declaredColorTokens, parseTokensCss } from './tokens-css';

/**
 * The presets are only useful if (a) they cover every real token, (b) the
 * "Original" preset IS tokens.css, and (c) every preset is as accessible as
 * the shipped theme. Each of those is asserted here, against the real file.
 */

// Read from disk: Vitest stubs CSS imports (even `?raw`) to an empty string.
const TOKENS_CSS = readFileSync(join(__dirname, '../../../styles/tokens.css'), 'utf8');
const PRESETS = buildPresets(TOKENS_CSS);

/**
 * `--color-primary` as tokens.css writes it for one mode, following at most one
 * `var(--…)` hop to the literal it names. Deliberately independent of the
 * resolver under test, so the assertion is "the playground shows the colour
 * the stylesheet declares", whichever form (literal or palette reference) the
 * stylesheet uses.
 */
function declaredPrimary(css: string, mode: 'light' | 'dark'): string {
  const body = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  const scopes = mode === 'light' ? [body(':root')] : [body('.dark'), body(':root')];
  const lookup = (name: string) =>
    scopes.map((b) => new RegExp(String.raw`--${name}:\s*([^;]+);`).exec(b)?.[1]?.trim()).find(Boolean) ?? '';
  const value = lookup('color-primary');
  const reference = /^var\(--([a-z0-9-]+)\)$/.exec(value)?.[1];
  return reference ? lookup(reference) : value;
}

/** The declarations of one top-level token block, comments stripped. */
function blockDeclarations(selector: ':root' | '.dark'): Map<string, string> {
  const clean = TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = clean.search(new RegExp(String.raw`(^|\n)${selector.replace('.', '\\.')} \{`));
  const body = at < 0 ? '' : clean.slice(clean.indexOf('{', at) + 1, clean.indexOf('}', at));
  return new Map([...body.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

describe('the token catalogue', () => {
  it('lists exactly the colour tokens tokens.css declares — editable roles plus copies, no more, no fewer', () => {
    expect([...WEB_TOKENS, ...COPIED_TOKEN_NAMES].sort()).toStrictEqual([...declaredColorTokens(TOKENS_CSS)].sort());
  });

  it('never lists a token as both an editor row and a copy', () => {
    const rows = new Set<string>(WEB_TOKENS);
    expect(COPIED_TOKEN_NAMES.filter((name) => rows.has(name))).toStrictEqual([]);
  });

  /*
   * What makes a copy a copy is tokens.css, not this list: the stylesheet
   * must declare it as a bare reference to its source, once, in `:root`.
   * A `.dark` redeclaration could give it a value of its own in one theme,
   * and the playground — which shows it as following its source — would lie.
   */
  it.each(COPIED_TOKEN_NAMES)('%s is declared in tokens.css as a plain reference to its source', (name) => {
    expect(blockDeclarations(':root').get(name)).toBe(`var(${COPIED_TOKENS[name].source})`);
    expect(blockDeclarations('.dark').has(name), `${name} is redeclared in .dark`).toBe(false);
  });

  it('copies only editable roles, so a copy never chains through another copy', () => {
    const rows = new Set<string>(WEB_TOKENS);
    for (const name of COPIED_TOKEN_NAMES) expect(rows.has(COPIED_TOKENS[name].source), name).toBe(true);
  });
});

describe('the Original preset', () => {
  it('is tokens.css, both modes, value for value', () => {
    const parsed = parseTokensCss(TOKENS_CSS);
    const original = PRESETS.find((p) => p.id === 'original');
    expect(original?.light).toStrictEqual(parsed.light);
    expect(original?.dark).toStrictEqual(parsed.dark);
    // A concrete colour, not a `var()`/`color-mix()` the rules and Copy cannot use.
    expect(declaredPrimary(TOKENS_CSS, 'light')).toMatch(/^#[0-9a-f]{6}$/);
    expect(declaredPrimary(TOKENS_CSS, 'dark')).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsed.light['--color-primary']).toBe(declaredPrimary(TOKENS_CSS, 'light'));
    expect(parsed.dark['--color-primary']).toBe(declaredPrimary(TOKENS_CSS, 'dark'));
    // Dark inherits what `.dark` does not redeclare, exactly as the cascade does.
    expect(parsed.dark['--color-control-knob']).toBe(parsed.light['--color-control-knob']);
  });
});

describe.each(PRESETS.map((p) => [p.label, p] as const))('%s', (_label, preset) => {
  it.each(['light', 'dark'] as const)('defines every token with a valid colour (%s)', (mode) => {
    for (const token of WEB_TOKENS) {
      expect(isValidColor(preset[mode][token]), `${mode}.${token} = "${preset[mode][token]}"`).toBe(true);
    }
  });

  it.each(['light', 'dark'] as const)('has no contrast failure (%s)', (mode) => {
    const failures = checkPalette(preset[mode])
      .filter((f) => f.severity === 'fail')
      .map((f) => f.message);
    expect(failures).toStrictEqual([]);
  });

  // Mirrors styles/contrast.test.ts for the shipped theme: the AI launcher's
  // edge is the mode's own neutral border-strong (not near-black), and the
  // button's boundary still reads at 3:1 against the navbar surface.
  it.each(['light', 'dark'] as const)('edges the AI launcher in border-strong (%s)', (mode) => {
    const palette = preset[mode];
    expect(palette['--color-ai-launcher-border']).toBe(palette['--color-border-strong']);
    const edge = contrastRatio(palette['--color-ai-launcher-border'], palette['--color-surface']);
    const fill = contrastRatio(palette['--color-ai-launcher'], palette['--color-surface']);
    expect(edge).not.toBeNull();
    expect(Math.max(edge ?? 0, fill ?? 0), `${mode} launcher boundary`).toBeGreaterThanOrEqual(3);
    // ...and its icon reads on the white fill (it once rendered white on white).
    const icon = contrastRatio(palette['--color-ai-launcher-icon'], palette['--color-ai-launcher']);
    expect(icon ?? 0, `${mode} launcher icon`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('clinical meaning', () => {
  const original = PRESETS[0];
  it('keeps status colours identical in every preset', () => {
    const status = ['--color-success', '--color-warning', '--color-error', '--color-info'] as const;
    for (const preset of PRESETS) {
      for (const mode of ['light', 'dark'] as const) {
        for (const tone of status) {
          expect(preset[mode][tone], `${preset.id} ${mode} ${tone}`).toBe(original?.[mode][tone]);
        }
      }
    }
  });

  it('keeps the AI accent distinguishable from primary in every curated preset', () => {
    // Original is tokens.css, not a palette the playground authors. On the
    // six-colour palette the stylesheet deliberately gives the AI accent no
    // hue of its own — "AI surfaces are told apart by their left rule and the
    // visible 'AI-generated' label" (its --color-accent comment) — so the
    // playground rightly shows that as a warning there. The curated presets
    // are what this rule constrains.
    const curated = PRESETS.filter((p) => p.id !== 'original');
    expect(curated.length).toBeGreaterThan(0);
    for (const preset of curated) {
      for (const mode of ['light', 'dark'] as const) {
        const hueWarnings = checkPalette(preset[mode]).filter((f) => f.id === 'hue:--color-accent/--color-primary');
        expect(hueWarnings, `${preset.id} ${mode}`).toStrictEqual([]);
      }
    }
  });
});
