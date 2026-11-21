import fs from 'node:fs';
import path from 'node:path';

import { AI_AVAILABILITY, OFFERED_CONTEXTS } from './availability';
import { SYMPTOM_OPTIONS } from './content/intake';
import { AI_CONTEXTS } from './model/types';

/**
 * The assistant is not connected, and cannot quietly become connected.
 *
 * ── Why this file exists ────────────────────────────────────────────
 *
 * Every other guarantee in `features/ai/` is a paragraph in a docblock,
 * and a paragraph does not survive a refactor by somebody who has not
 * read it. Phase K's gate (audit AD-4, R-5) is the one place in this
 * repository where the difference between "documented" and "asserted"
 * is a safety difference, so these are assertions.
 *
 * The failure mode being guarded against is specific and it is not
 * malice. It is a contributor who wants the screen to feel finished:
 * seeding a greeting in the transcript, scripting an answer behind the
 * composer, adding a fixture adapter that replies in development builds,
 * or writing a red-flag matcher into the client. Each of those makes a
 * machine answer a medical question with words no clinician has read.
 * Each of them fails a test below.
 *
 * ── What these tests do NOT claim ───────────────────────────────────
 *
 * They do not prove the assistant is safe — nothing in a client test
 * suite could. They prove it is **absent**, which is the only property
 * this tree is currently entitled to claim.
 */

const AI_DIR = __dirname;

function sourceFiles(dir: string): { file: string; source: string }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [{ file: path.relative(AI_DIR, full), source: fs.readFileSync(full, 'utf8') }];
  });
}

/** Block and line comments stripped, so a prohibition is not a finding. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const SOURCES = sourceFiles(AI_DIR).map(({ file, source }) => ({
  file,
  source: withoutComments(source),
}));

describe('the assistant is declared unavailable', () => {
  it('reports not-connected, with the rows it is waiting on', () => {
    expect(AI_AVAILABILITY.connected).toBe(false);
    expect(AI_AVAILABILITY.reason).toBe('not-implemented');
    // AD-4 is the decision, BE-14 the endpoint. Naming them is what lets
    // the screens render provenance instead of a shrug.
    expect([...AI_AVAILABILITY.blockedBy].sort()).toEqual(['AD-4', 'BE-14']);
  });

  it('offers exactly the four patient contexts K-01 names', () => {
    expect([...OFFERED_CONTEXTS].sort()).toEqual([...AI_CONTEXTS].sort());
  });

  it('offers none of the clinician modes', () => {
    // K-01's substance: `record`, `labs` and `pharmacy` read a chart and
    // reason about it. A patient-facing assistant that did the same
    // would be giving a diagnosis with a disclaimer stapled to it.
    for (const clinicianMode of ['record', 'labs', 'pharmacy']) {
      expect(AI_CONTEXTS as readonly string[]).not.toContain(clinicianMode);
    }
  });
});

describe('nothing in this tree talks to anything', () => {
  it('makes no network call, by any of the names one goes by', () => {
    const offenders = SOURCES.filter(({ source }) =>
      /\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket|apiClient|\bnew Request\b/.test(source),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('imports nothing from the api layer', () => {
    // No endpoint module, no client, and — deliberately — no service
    // seam. `selectService` is a promise that something can be plugged
    // in; nothing can be plugged in yet, and a seam with two identical
    // empty adapters is an invitation to fill one of them in.
    const offenders = SOURCES.filter(({ source }) =>
      /from '@\/api\/|from '\.\.?\/.*\/?(seam|client|endpoints)'/.test(source),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('declares no service, so there is no adapter to quietly fill in', () => {
    expect(fs.existsSync(path.join(AI_DIR, 'service.ts'))).toBe(false);
  });

  it('persists nothing — not a draft, not a transcript', () => {
    // K-07 requires server-side persistence and forbids the local kind
    // by name; T-03 forbids PHI on disk outright, and what a patient
    // says about their own body is PHI.
    const offenders = SOURCES.filter(({ source }) =>
      /AsyncStorage|SecureStore|MMKV|preferenceStore|localStorage|createTokenStorage/.test(source),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('nothing in this tree produces an answer', () => {
  it('stores no assistant prose that a screen could present as a reply', () => {
    // The shape of a scripted reply: a long sentence in a source file,
    // outside the message catalogue, that reads as an answer. The
    // intake's option list is short labels and the components read the
    // catalogue, so a multi-clause sentence here is the smell.
    const offenders: string[] = [];
    for (const { file, source } of SOURCES) {
      // Single-line only: an apostrophe in prose would otherwise pair
      // with one several imports away and match the code between them.
      for (const match of source.matchAll(/'([^'\\\n]{80,})'/g)) {
        offenders.push(`${file} → ${(match[1] ?? '').slice(0, 60)}…`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('runs no client-side red-flag classification (K-04)', () => {
    // "Classification is server-side. The client must not be the only
    // guard." A bundled matcher cannot be corrected on a phone that has
    // shipped, and a patient can be reassured by one that does not fire.
    const offenders = SOURCES.filter(({ file, source }) =>
      // A screen that branches on which symptoms were chosen is the
      // shape of a matcher. `selected.size` — how many — is a form's
      // "can I continue" and is not.
      /\bRED_FLAGS?\b|isEmergencySymptom|classif|triage/i.test(`${file} ${source}`),
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('keeps the intake a vocabulary, with no severity or weighting on any entry', () => {
    // A score, a rank or a severity on an option is the beginning of a
    // classifier. Every option is an id, a message key and a group.
    for (const option of SYMPTOM_OPTIONS) {
      expect(Object.keys(option).sort()).toEqual(['group', 'id', 'labelKey']);
    }
  });

  it('gives every intake option a catalogue key rather than a literal', () => {
    for (const option of SYMPTOM_OPTIONS) {
      expect(option.labelKey.startsWith('ai.symptom.')).toBe(true);
    }
  });
});
