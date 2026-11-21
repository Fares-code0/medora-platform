import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPresets } from './presets';
import type { Palette, WebToken } from './tokens';

/**
 * Web ⇄ patient parity.
 *
 * The two apps share no runtime package, so each keeps its own copy — the web
 * keyed by CSS variable, the patient app by `ColorPalette` key. This reads
 * the patient copies as TEXT (importing them would drag in the patient app's
 * own `@/` alias) and fails on any value that differs:
 *
 *  - Original:  `frontend/src/styles/tokens.css`  ⇄  `patient-app/src/theme/tokens.ts`
 *               — the clinical STATUS tones only (ADR-0005)
 *  - Presets:   this folder's `presets.ts`        ⇄  `patient-app/src/features/theme-playground/model/presets.ts`
 *               — every shared value
 *
 * ADR-0005 let the shipped palettes diverge: the web took the EMR visual
 * language (clinical blue, charcoal sidebar), the patient app kept its own.
 * A brand palette is per product. What a status colour MEANS is not — an
 * error is the same red, a success the same green, in both apps — so those
 * nine tones are still held identical, in both modes. The curated playground
 * presets are unchanged and still agree value for value.
 *
 * `frontend` and `patient-app` are separate integration branches, so on a
 * checkout without the patient file a check reads, that check skips rather
 * than fails — the same
 * arrangement as the patient app's own `parity.test.ts` against `backend/`.
 */

const ROOT = join(__dirname, '../../../../..');
const PATIENT_TOKENS = join(ROOT, 'patient-app/src/theme/tokens.ts');
const PATIENT_PRESETS = join(ROOT, 'patient-app/src/features/theme-playground/model/presets.ts');

const PRESETS = buildPresets(readFileSync(join(__dirname, '../../../styles/tokens.css'), 'utf8'));

/** The clinical status tones — the part of the shipped palette both apps must share. */
const STATUS = /^--color-(?:success|warning|error|info)(?:-hover|-subtle)?$/;
const STATUS_TONES = [
  '--color-success',
  '--color-success-subtle',
  '--color-warning',
  '--color-warning-subtle',
  '--color-error',
  '--color-error-hover',
  '--color-error-subtle',
  '--color-info',
  '--color-info-subtle',
] as const;

/** `textPrimary` → `--color-text-primary`. */
const cssName = (key: string) => `--color-${key.replace(/([A-Z0-9])/g, (c) => `-${c.toLowerCase()}`)}`;

function pairs(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, key, value] of block.matchAll(/^\s+(\w+): '([^']+)',$/gm)) {
    if (key !== undefined && value !== undefined) out[cssName(key)] = value;
  }
  return out;
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`"${start}" not found`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to < 0 ? undefined : to);
}

/** Every web token the patient value is given for must match; web-only tokens are skipped. */
function mismatches(web: Palette, patient: Record<string, string>): string[] {
  return Object.entries(patient)
    .filter(([css, value]) => web[css as WebToken] !== value)
    .map(([css, value]) => `${css}: web ${web[css as WebToken] ?? '(missing)'} ≠ patient ${value}`);
}

// Each half skips on its own file. They used to share one `present` flag, so a
// patient tree without the playground presets silently skipped the Original
// check too — on such a checkout it never ran.
describe.skipIf(!existsSync(PATIENT_TOKENS))('web ⇄ patient status parity', () => {
  it('Original: tokens.css and tokens.ts hold the same clinical status tones (ADR-0005)', () => {
    const source = readFileSync(PATIENT_TOKENS, 'utf8');
    const status = (all: Record<string, string>) =>
      Object.fromEntries(Object.entries(all).filter(([css]) => STATUS.test(css)));
    const light = pairs(between(source, 'export const lightColors', '};'));
    const dark = pairs(between(source, 'export const darkColors', '};'));
    expect(Object.keys(light)).toHaveLength(42);
    // Not vacuous: all nine status tones are found on the patient side, in both modes.
    expect(Object.keys(status(light)).sort()).toStrictEqual([...STATUS_TONES].sort());
    expect(Object.keys(status(dark)).sort()).toStrictEqual([...STATUS_TONES].sort());
    expect(mismatches(PRESETS[0]!.light, status(light))).toEqual([]);
    expect(mismatches(PRESETS[0]!.dark, status(dark))).toEqual([]);
  });
});

describe.skipIf(!existsSync(PATIENT_PRESETS))('web ⇄ patient playground preset parity', () => {
  it.each([
    ['medical-blue', 'MEDICAL_BLUE'],
    ['midnight-purple', 'MIDNIGHT_PURPLE'],
    ['emerald-green', 'EMERALD_GREEN'],
  ] as const)('%s: the two playground copies agree on every value', (id, constName) => {
    const source = readFileSync(PATIENT_PRESETS, 'utf8');
    const statusLight = pairs(between(source, 'const STATUS_LIGHT', '} as const;'));
    const statusDark = pairs(between(source, 'const STATUS_DARK', '} as const;'));
    const body = between(source, `const ${constName}: ThemePreset`, '\n};');
    const light = { ...pairs(between(body, 'light: {', 'dark: {')), ...statusLight };
    const dark = { ...pairs(body.slice(body.indexOf('dark: {'))), ...statusDark };

    const web = PRESETS.find((p) => p.id === id)!;
    // 42 ColorPalette keys + the 3 web-only roles the patient copy carries for exports.
    expect(Object.keys(light)).toHaveLength(45);
    expect(mismatches(web.light, light)).toEqual([]);
    expect(mismatches(web.dark, dark)).toEqual([]);
  });
});
