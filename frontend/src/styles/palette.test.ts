import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TOKENS_CSS, declared } from '@/test/tokens';

/**
 * The palette invariant — every theme colour comes from the approved values.
 *
 * ADR-0001 introduced the invariant over six slate-blue values; ADR-0005
 * re-based it on the EMR palette (a clinical blue, a cool neutral ladder and
 * a charcoal ink ladder). The set changed; the rule did not. The approved
 * values are the whole visual identity, and the failure this guards against
 * is gradual: a one-off hex in a component, a "temporary" slate in a new
 * token, and a year later the app is two palettes again. Each of these
 * assertions closes one door that drift used before.
 *
 * Exceptions are named, not patterned, so adding one is a visible decision in
 * a diff rather than a regex that quietly widened:
 *  - the four clinical status tones (tokens.css explains why);
 *  - neutral black in dark-theme shadows — nothing in the palette is darker
 *    than the page those shadows fall on;
 *  - the per-file literals in EXCEPTIONS below;
 *  - the exact files in DEV_ONLY_FILES below, which no build can contain.
 */

/** The approved primitives, by the name tokens.css declares them under (ADR-0005). */
const PALETTE = {
  'blue-700': '#1268ad',
  'blue-600': '#1677c8',
  'blue-400': '#5aa6ea',
  'blue-200': '#d8eafb',
  'blue-100': '#e8f2fc',
  white: '#ffffff',
  'gray-50': '#f5f7fa',
  'gray-100': '#f1f5f8',
  'gray-200': '#e5eaf0',
  'gray-300': '#a5afba',
  'gray-400': '#7e8b99',
  'gray-600': '#5f6b78',
  'gray-900': '#202832',
  'ink-950': '#0b0d0f',
  'ink-900': '#111519',
  'ink-800': '#1b252e',
  'ink-700': '#25303b',
} as const;

const APPROVED = new Set<string>(Object.values(PALETTE));

/** Status tones — the one family allowed literal values. */
const STATUS_TOKEN = /^color-(?:success|warning|error|info)(?:-hover|-subtle)?$/;

/** A theme colour must be one of these shapes, built only from primitives. */
const PALETTE_REF = String.raw`var\(--palette-(?:${Object.keys(PALETTE).join('|')})\)`;
const BUILT_FROM_PALETTE = new RegExp(
  String.raw`^(?:${PALETTE_REF}|color-mix\(in srgb, ${PALETTE_REF} \d+%, (?:${PALETTE_REF}|transparent)\)|transparent)$`,
);

function stripComments(source: string): string {
  // `//` only where it starts a comment, not inside `http://`.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Every colour literal in a source text, normalised to lower-case #rrggbb. */
function colourLiterals(source: string): string[] {
  const out: string[] = [];
  for (const [hex] of source.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const h = hex.toLowerCase();
    out.push(h.length === 4 ? `#${h[1]!}${h[1]!}${h[2]!}${h[2]!}${h[3]!}${h[3]!}` : h);
  }
  for (const [, r, g, b] of source.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    out.push(`#${[r, g, b].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`);
  }
  return out;
}

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(tsx?|css)$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const rel = (file: string): string => relative(SRC, file).split(sep).join('/');

/** Files allowed a literal outside the palette, and exactly which ones. */
const EXCEPTIONS: Record<string, readonly string[]> = {
  // The fixed brand-mark colours a caller can pin (`<Logo color="light">`):
  // the logo artwork's own black and white, not the interface theme.
  'shared/components/branding/Logo.tsx': ['#111111', '#000000', '#ffffff'],
  // Mask luminance, not paint — white is "fully shown" inside an SVG mask.
  // The visible ink is --color-text-primary / the panel's own accent.
  'shared/components/branding/MedoraIntro.css': ['#ffffff'],
  'features/auth/layout/BrandPanel.tsx': ['#ffffff'],
  // Theme Playground, compiled out of every build (see DEV_ONLY_FILES). White
  // is the WCAG reference ground `contrastRatio` composites a colour onto…
  'features/theme-playground/model/color.ts': ['#ffffff'],
  // …and black the colour picker's fallback for a value it cannot parse
  // (`<input type="color">` takes only #rrggbb).
  'features/theme-playground/components/TokenEditor.tsx': ['#000000'],
};

/**
 * Whole files allowed any literal — each named exactly, never by pattern.
 * Only for code that no build can contain, so none of its colours can reach
 * the app this invariant protects.
 */
const DEV_ONLY_FILES: readonly string[] = [
  // The Theme Playground's curated alternative palettes: the file exists to
  // hold colours outside this one. The playground route is registered only
  // when `import.meta.env.MEDORA_THEME_PLAYGROUND` is true, which vite.config.ts
  // sets on the local dev server alone (app/router/index.tsx), and
  // themePlaygroundBoundaryPlugin (scripts/theme-playground-boundary.ts) fails
  // any `vite build` that still contains playground code.
  'features/theme-playground/model/presets.ts',
];

describe('palette — tokens.css', () => {
  it('declares the approved colours once each, in :root only — and nothing else as a primitive', () => {
    for (const [name, hex] of Object.entries(PALETTE)) {
      const declarations = [...TOKENS_CSS.matchAll(new RegExp(String.raw`--palette-${name}:\s*([^;]+);`, 'g'))];
      expect(declarations.map((m) => m[1]!.toLowerCase()), `--palette-${name}`).toStrictEqual([hex]);
    }
    const declaredNames = [...stripComments(TOKENS_CSS).matchAll(/--palette-([a-z0-9-]+):/g)].map((m) => m[1]!);
    expect(declaredNames.sort()).toStrictEqual(Object.keys(PALETTE).sort());
    const dark = TOKENS_CSS.slice(TOKENS_CSS.indexOf('.dark {'));
    expect(dark).not.toMatch(/--palette-[a-z0-9-]+:/);
  });

  it('builds every theme colour from the primitives, in both themes', () => {
    const names = new Set(
      [...TOKENS_CSS.matchAll(/--(color-[a-z0-9-]+):/g)].map((m) => m[1]!),
    );
    const offenders: string[] = [];
    for (const name of names) {
      if (STATUS_TOKEN.test(name)) continue;
      for (const theme of ['light', 'dark'] as const) {
        const value = declared(name, theme);
        // A COPY (ADR-0005) is a bare reference to another role, which must
        // itself be built from the primitives — one hop, never a chain.
        const copyOf = /^var\(--(color-[a-z0-9-]+)\)$/.exec(value)?.[1];
        const built = copyOf === undefined ? value : declared(copyOf, theme);
        if (!BUILT_FROM_PALETTE.test(built) && !(copyOf !== undefined && STATUS_TOKEN.test(copyOf))) {
          offenders.push(`--${name} (${theme}): ${value}`);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('holds no other colour literal — status tones and black shadows excepted', () => {
    const offenders = stripComments(TOKENS_CSS)
      .split('\n')
      .filter((line) => colourLiterals(line).length > 0)
      .filter((line) => !/^\s*--palette-[a-z0-9-]+:/.test(line))
      .filter((line) => !/^\s*--color-(?:success|warning|error|info)(?:-hover|-subtle)?:/.test(line))
      .filter((line) => !colourLiterals(line).every((hex) => hex === '#000000'))
      .map((line) => line.trim());
    expect(offenders).toStrictEqual([]);
  });
});

describe('palette — application source', () => {
  it('uses no colour outside the palette, apart from the named exceptions', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const path = rel(file);
      if (path === 'styles/tokens.css' || DEV_ONLY_FILES.includes(path)) continue;
      const allowed = new Set([...APPROVED, ...(EXCEPTIONS[path] ?? [])]);
      for (const hex of colourLiterals(stripComments(readFileSync(file, 'utf8')))) {
        if (!allowed.has(hex)) offenders.push(`${path}: ${hex}`);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('reads the primitives only where a non-flipping value is the point', () => {
    // A component on --palette-* has opted out of theming. The token files
    // build the roles from them; the auth brand panel holds one look in both
    // themes on purpose (BrandPanel.css explains why).
    const readers = sourceFiles(SRC)
      .filter((file) => /var\(--palette-/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel)
      .sort();
    expect(readers).toStrictEqual([
      'features/auth/layout/BrandPanel.css',
      'styles/globals.css',
      'styles/tokens.css',
    ]);
  });

  it('keeps the exceptions honest — each one is still used', () => {
    // A stale exception is an open door. When the literal goes, so does the
    // entry.
    for (const [path, literals] of Object.entries(EXCEPTIONS)) {
      const found = new Set(colourLiterals(stripComments(readFileSync(join(SRC, path), 'utf8'))));
      for (const hex of literals) expect(found.has(hex), `${path} no longer uses ${hex}`).toBe(true);
    }
    for (const path of DEV_ONLY_FILES) {
      expect(existsSync(join(SRC, path)), `${path} no longer exists`).toBe(true);
      const offPalette = colourLiterals(stripComments(readFileSync(join(SRC, path), 'utf8'))).filter(
        (hex) => !APPROVED.has(hex),
      );
      expect(offPalette.length, `${path} no longer needs its exemption`).toBeGreaterThan(0);
    }
  });
});
