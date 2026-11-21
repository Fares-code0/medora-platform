import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { toJson, type ThemeExport } from './export';
import { buildPresets } from './presets';
import { STORAGE_KEYS, loadDraft, loadSaved, storeSaved } from './storage';

/**
 * A stored experiment is never destroyed for being old or unreadable: an
 * older one is migrated and the page is told what changed; one that cannot
 * be read at all is kept, verbatim, and the page is told it was kept.
 */

const PRESETS = buildPresets(readFileSync(join(__dirname, '../../../styles/tokens.css'), 'utf8'));
const original = PRESETS[0]!;
const blue = PRESETS.find((p) => p.id === 'medical-blue')!;
const theme = (name: string): ThemeExport => ({ name, light: blue.light, dark: blue.dark });

/** A theme as the catalogue before the component roles wrote it. */
function legacy(name: string): unknown {
  const data = JSON.parse(toJson(theme(name))) as { light: Record<string, string>; dark: Record<string, string> };
  for (const palette of [data.light, data.dark]) {
    delete palette['--color-tab-indicator'];
    delete palette['--color-ai-badge'];
    palette['--color-secondary'] = '#0f6e66';
  }
  return data;
}

const UNREADABLE = { format: 'medora-theme@1', name: 'Broken', light: { '--color-primary': 'nope' } };

afterEach(() => {
  window.localStorage.clear();
});

describe('saved experiments', () => {
  it('loads one saved by an earlier catalogue, and says what was migrated', () => {
    window.localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify([legacy('Ocean')]));
    const { value, notes } = loadSaved(original);
    expect(value.map((t) => t.name)).toStrictEqual(['Ocean']);
    expect(value[0]!.light['--color-tab-indicator']).toBe(blue.light['--color-primary']);
    expect(notes.some((n) => n.startsWith('Saved "Ocean" — Added roles this theme predates'))).toBe(true);
    expect(notes.some((n) => n.includes('Secondary (#0f6e66) now follows Primary'))).toBe(true);
  });

  it('keeps an unreadable entry through every later save instead of erasing it', () => {
    window.localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify([JSON.parse(toJson(theme('A'))), UNREADABLE]));
    const { value, notes } = loadSaved(original);
    expect(value.map((t) => t.name)).toStrictEqual(['A']);
    expect(notes).toContain(
      '1 saved experiment(s) could not be read. They are kept in storage, untouched, and are not listed.',
    );

    storeSaved([...value, theme('B')], original);
    storeSaved([theme('B')], original); // delete "A"

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.saved)!) as { name: string }[];
    expect(stored.map((e) => e.name)).toStrictEqual(['B', 'Broken']);
    expect(stored[1]).toStrictEqual(UNREADABLE);
  });
});

describe('the working draft', () => {
  it('loads a legacy draft and labels its notes as the draft’s', () => {
    const entry = legacy('Draft');
    window.localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify({ custom: entry, origin: entry }));
    const { value, notes } = loadDraft(original);
    expect(value?.custom.name).toBe('Draft');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.startsWith('Working draft — '))).toBe(true);
    // The fork and its origin share notes; they are not repeated.
    expect(new Set(notes).size).toBe(notes.length);
  });

  it('moves an unreadable draft aside before anything can overwrite it', () => {
    const raw = JSON.stringify({ custom: UNREADABLE, origin: UNREADABLE });
    window.localStorage.setItem(STORAGE_KEYS.draft, raw);
    const { value, notes } = loadDraft(original);
    expect(value).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.draftUnreadable)).toBe(raw);
    expect(notes[0]).toContain(STORAGE_KEYS.draftUnreadable);
  });
});
