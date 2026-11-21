import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Text-role invariants — ADR-0001 §10.
 *
 * The rule: `text-tertiary` is glanceable METADATA only — timestamps, units,
 * axis labels, helper hints, icon tints. Anything a clinician reads character
 * by character (an MRN, a patient ID, a licence number, an ICD code, an
 * appointment reference) is DATA and must not be rendered in the faintest
 * tint at caption size.
 *
 * This guards the class of defect rather than a list of files: it fails when
 * a NEW identifier is introduced in tertiary, which is how the original 157
 * mis-roled sites accumulated in the first place.
 */

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(p);
  }
  return out;
}

/** The JSX element owning a class attribute, so we can see what it renders. */
function elementAt(src: string, idx: number): { open: string; inner: string } | null {
  const lt = src.lastIndexOf('<', idx);
  if (lt === -1) return null;
  let depth = 0;
  let endOpen = -1;
  for (let i = lt; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) {
      endOpen = i;
      break;
    }
  }
  if (endOpen === -1) return null;
  const open = src.slice(lt, endOpen + 1);
  if (open.endsWith('/>')) return { open, inner: '' };
  const tag = /^<\s*([A-Za-z][\w.]*)/.exec(open)?.[1];
  if (tag === undefined) return null;
  const close = src.indexOf(`</${tag}`, endOpen);
  return { open, inner: close === -1 ? '' : src.slice(endOpen + 1, close) };
}

/**
 * Identifiers a reader matches character by character. Deliberately narrow —
 * this asserts the rule's clearest edge, not every judgement call in it.
 */
const IDENTIFIER = /\b(mrn|licenseNumber|licenceNumber)\b|\bICD-10\b/i;

describe('text roles', () => {
  const files = sourceFiles(SRC);

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('never renders a patient or clinical identifier in text-tertiary', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const re = /text-text-tertiary/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const el = elementAt(src, m.index);
        if (el === null || !el.open.includes('text-text-tertiary')) continue;
        if (!IDENTIFIER.test(el.inner)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${relative(SRC, file).split(sep).join('/')}:${line}`);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('keeps primary the dominant text role over tertiary', () => {
    // The inversion was the finding: tertiary outnumbered primary 346 to 243,
    // i.e. most of the app's text was in its faintest colour. This asserts the
    // direction of that fix, not a precise ratio.
    //
    // Two assertions, and they are not the same claim. The RATIO is the one
    // that encodes the inversion, and it is the one to tighten: the finding
    // sat at 243/346 = 0.70, and every merge since has held 0.90-0.96. The
    // absolute CEILING is a coarse companion — it counts how much UI exists,
    // not how much of it is mis-roled, so it climbs with the app whether or
    // not the roles are right (282 -> 346 across the last nine merges, ratio
    // flat throughout). It is re-baselined when GROWTH reaches it, never to
    // absorb drift.
    //
    // Re-baselined 346 -> 347 on 2026-09-01. The two usages that crossed it
    // arrived together in #55. One was a real mis-role — a lab test code, read
    // character by character, rendered in the faintest tint — and it was FIXED
    // in PatientLabStudiesTab, not absorbed here. The other is a study date,
    // which is precisely the glanceable metadata tertiary exists for. If a
    // future bump cannot name which side of that line each new usage falls on,
    // it is drift, and the usages are what should move.
    //
    // Re-baselined 347 -> 348 on 2026-09-01 for D-15's Notes section. Two
    // usages arrived; only one stayed. The attribution line (author ·
    // timestamp · which analyte) is glanceable metadata and matches the
    // reviewer line LabCells already renders that way. The other was the
    // "nothing was transmitted" disclosure, and it MOVED to secondary
    // rather than being absorbed here: an honesty marker in the faintest
    // tint is one a reader skips, which defeats the only reason it exists.
    //
    // Re-baselined 348 -> 349 on 2026-09-01 for DX-23's lab ordering flow.
    // Three usages arrived and one moved out. Kept: the test catalogue's
    // "Chemistry · Serum · 8 analytes" caption and FlowStepper's step
    // numeral, both glanceable metadata (the numeral is aria-hidden).
    // Moved to secondary: FlowStepper's "Step 1 of 3 · complete" line —
    // that is STATE, and ADR-0001's "never state by colour alone" is not
    // satisfied by putting the text in the faintest tint a reader skips.
    // The pharmacy's original copy had it secondary and was right.
    let primary = 0;
    let tertiary = 0;
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      primary += (src.match(/text-text-primary/g) ?? []).length;
      tertiary += (src.match(/text-text-tertiary/g) ?? []).length;
    }
    expect(tertiary).toBeLessThan(349);
    expect(primary / tertiary).toBeGreaterThan(0.9);
  });
});
