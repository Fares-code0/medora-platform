import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATIENT_KEYS, parseThemeJson, toCss, toJson, toTypeScript } from './export';
import { buildPresets } from './presets';
import { COPIED_TOKEN_NAMES, COPIED_TOKENS, WEB_TOKENS } from './tokens';
import { parseTokensCss } from './tokens-css';

const TOKENS_CSS = readFileSync(join(__dirname, '../../../styles/tokens.css'), 'utf8');
const PRESETS = buildPresets(TOKENS_CSS);
const blue = PRESETS.find((p) => p.id === 'medical-blue')!;
const theme = { name: blue.label, light: blue.light, dark: blue.dark };

describe('CSS export', () => {
  const css = toCss(theme);

  it('carries every token in both blocks', () => {
    for (const token of WEB_TOKENS) {
      expect(css).toContain(`${token}: ${blue.light[token]};`);
      expect(css).toContain(`${token}: ${blue.dark[token]};`);
    }
  });

  it('writes each copy once, in :root, as the reference tokens.css uses', () => {
    const [root, dark] = css.split('.dark {');
    for (const name of COPIED_TOKEN_NAMES) {
      expect(root).toContain(`${name}: var(${COPIED_TOKENS[name].source});`);
      expect(dark).not.toContain(`${name}:`);
    }
  });

  it('reads back as the same palette — it is tokens.css-shaped', () => {
    const parsed = parseTokensCss(css);
    expect(parsed.light).toStrictEqual(blue.light);
    expect(parsed.dark).toStrictEqual(blue.dark);
  });
});

describe('TypeScript export', () => {
  const ts = toTypeScript(theme);

  it('declares both patient palettes with every ColorPalette key', () => {
    expect(ts).toContain('export const lightColors: ColorPalette = {');
    expect(ts).toContain('export const darkColors: ColorPalette = {');
    // 39 editable roles plus the three `secondary` copies, which keep their
    // patient keys and take their source's value.
    expect(PATIENT_KEYS).toHaveLength(42);
    expect(new Set(PATIENT_KEYS.map((k) => k.key)).size).toBe(42);
    for (const { key, token } of PATIENT_KEYS) {
      expect(ts).toContain(`  ${key}: '${blue.light[token]}',`);
      expect(ts).toContain(`  ${key}: '${blue.dark[token]}',`);
    }
    expect(ts).toContain(`  secondary: '${blue.light['--color-primary']}',`);
  });

  it('names the web-only roles it leaves out rather than dropping them silently', () => {
    expect(ts).toContain('--color-text-placeholder');
    expect(ts).toContain('--color-scrollbar-thumb');
  });
});

describe('JSON export', () => {
  it('round-trips', () => {
    const result = parseThemeJson(toJson(theme));
    expect(result).toStrictEqual({ ok: true, theme });
  });

  it('refuses an incomplete palette instead of filling gaps', () => {
    const data = JSON.parse(toJson(theme)) as { light: Record<string, string> };
    delete data.light['--color-chart-4-edge'];
    const result = parseThemeJson(JSON.stringify(data));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('chart-4-edge');
  });

  it('refuses a damaged legacy role rather than filling over it', () => {
    const data = JSON.parse(toJson(theme)) as { light: Record<string, string> };
    data.light['--color-tab-indicator'] = 'not-a-colour';
    const result = parseThemeJson(JSON.stringify(data));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('tab-indicator');
  });

  it('refuses a document in another format', () => {
    expect(parseThemeJson('{"light":{}}').ok).toBe(false);
    expect(parseThemeJson('not json').ok).toBe(false);
  });
});

/*
 * Backward compatibility. A theme saved by an earlier catalogue lacks the
 * roles added since and may still carry the four that became copies. It must
 * load, deterministically, and say what changed.
 */
describe('JSON import from an earlier catalogue', () => {
  const original = PRESETS[0]!;
  const SPLIT = {
    '--color-primary-fill': '--color-primary',
    '--color-primary-fill-hover': '--color-primary-hover',
    '--color-primary-fill-text': '--color-text-inverse',
    '--color-tab-active-text': '--color-text-primary',
    '--color-tab-indicator': '--color-primary',
    '--color-ai-badge': '--color-accent-subtle',
    '--color-ai-badge-text': '--color-accent',
  } as const;
  const SIDEBAR = WEB_TOKENS.filter((t) => t.startsWith('--color-sidebar'));

  /** What the catalogue before ADR-0005 wrote: no fill, sidebar or component roles; the copies as values. */
  function legacyDocument(): { light: Record<string, string>; dark: Record<string, string> } {
    const data = JSON.parse(toJson(theme)) as { light: Record<string, string>; dark: Record<string, string> };
    for (const palette of [data.light, data.dark]) {
      for (const token of [...Object.keys(SPLIT), ...SIDEBAR]) delete palette[token];
      palette['--color-secondary'] = '#0f6e66';
      palette['--color-secondary-hover'] = palette['--color-primary-hover']!;
      palette['--color-secondary-subtle'] = palette['--color-primary-subtle']!;
      palette['--color-scrollbar-thumb'] = palette['--color-border-strong']!;
    }
    return data;
  }

  it('loads, filling each split role from the token it was split out of', () => {
    const result = parseThemeJson(JSON.stringify(legacyDocument()), original);
    if (!result.ok) throw new Error(result.error);
    for (const mode of ['light', 'dark'] as const) {
      for (const [token, from] of Object.entries(SPLIT)) {
        expect(result.theme[mode][token as keyof typeof SPLIT], `${mode} ${token}`).toBe(blue[mode][from]);
      }
    }
  });

  it('gives roles the document predates entirely their shipped value', () => {
    const result = parseThemeJson(JSON.stringify(legacyDocument()), original);
    if (!result.ok) throw new Error(result.error);
    for (const mode of ['light', 'dark'] as const) {
      for (const token of SIDEBAR) expect(result.theme[mode][token]).toBe(original[mode][token]);
    }
  });

  it('refuses, rather than guesses, when it has no shipped value to give them', () => {
    const result = parseThemeJson(JSON.stringify(legacyDocument()));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('--color-sidebar');
  });

  it('is deterministic — the same document always loads the same theme', () => {
    const text = JSON.stringify(legacyDocument());
    expect(parseThemeJson(text, original)).toStrictEqual(parseThemeJson(text, original));
  });

  it('says what it filled, and names a copy whose saved value it superseded', () => {
    const result = parseThemeJson(JSON.stringify(legacyDocument()), original);
    if (!result.ok) throw new Error(result.error);
    const notes = result.notes ?? [];
    expect(notes[0]).toMatch(/^Added roles this theme predates: .*Primary Button Fill \(from Primary\)/);
    expect(notes[0]).toContain('Sidebar (shipped value)');
    // secondary differed from primary in both modes: said. The other three
    // equalled their source, so nothing was lost and nothing is said.
    expect(notes.filter((n) => n.includes('Secondary (#0f6e66) now follows Primary'))).toHaveLength(2);
    expect(notes.some((n) => n.includes('Secondary Hover') || n.includes('Scrollbar Thumb'))).toBe(false);
  });

  it('names an unknown key instead of dropping it silently', () => {
    const data = JSON.parse(toJson(theme)) as { light: Record<string, string> };
    data.light['--color-legacy-thing'] = '#123456';
    const result = parseThemeJson(JSON.stringify(data), original);
    if (!result.ok) throw new Error(result.error);
    expect(result.notes).toStrictEqual(['light: ignored "--color-legacy-thing", which is not a Medora colour token.']);
  });

  it('re-exports as the current catalogue — no copies, no legacy keys', () => {
    const result = parseThemeJson(JSON.stringify(legacyDocument()), original);
    if (!result.ok) throw new Error(result.error);
    const written = JSON.parse(toJson(result.theme)) as { light: Record<string, string> };
    expect(Object.keys(written.light).sort()).toStrictEqual([...WEB_TOKENS].sort());
    expect(parseThemeJson(toJson(result.theme), original)).toStrictEqual({ ok: true, theme: result.theme });
  });
});
