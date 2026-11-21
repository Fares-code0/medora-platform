import type { LegacyOriginal, ThemeExport } from './export';
import { parseThemeJson, toJson } from './export';

/**
 * Local storage for EXPERIMENTS only.
 *
 * Keys live under `medora.dev.theme-playground.*`. None is read by anything
 * outside this feature, and the real preferences — `medora.theme`,
 * `medora.interface`, the per-user `medora.<id>.*` namespace written by
 * `services/preferences.ts` — are never read or written here. Experimenting
 * cannot change what Medora looks like for anyone, including you, until you
 * copy a value into tokens.css by hand.
 *
 * Stored as `medora-theme@1` JSON so a saved experiment is validated on the
 * way back in by the same parser that reads an import — which also migrates
 * one saved by an older catalogue (`LEGACY_FILLS`) and says what it changed.
 * Every access is wrapped: storage can be absent (private mode, quota), and
 * a dev tool that crashed for it would be worse than one that forgets.
 *
 * Nothing stored is destroyed for being unreadable. A saved experiment this
 * catalogue cannot parse stays in the saved list, untouched, across every
 * later save; an unreadable draft is moved to `draftUnreadable` before the
 * working draft is replaced. Both are reported through `notes`.
 */

const PREFIX = 'medora.dev.theme-playground';
export const STORAGE_KEYS = {
  draft: `${PREFIX}.draft`,
  draftUnreadable: `${PREFIX}.draft.unreadable`,
  saved: `${PREFIX}.saved`,
} as const;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — experiments simply are not remembered.
  }
}

/** The working Custom theme plus the palette its resets return to. */
export interface StoredDraft {
  readonly custom: ThemeExport;
  readonly origin: ThemeExport;
}

export interface Loaded<T> {
  readonly value: T;
  /** Migrations and preserved-but-unreadable entries, worded for the page. */
  readonly notes: readonly string[];
}

export function loadDraft(original?: LegacyOriginal): Loaded<StoredDraft | null> {
  const raw = read(STORAGE_KEYS.draft);
  if (raw === null) return { value: null, notes: [] };
  try {
    const data = JSON.parse(raw) as { custom?: unknown; origin?: unknown };
    const custom = parseThemeJson(JSON.stringify(data.custom), original);
    const origin = parseThemeJson(JSON.stringify(data.origin), original);
    if (custom.ok && origin.ok) {
      // The origin's notes repeat the custom theme's for an unedited fork.
      const notes = [...new Set([...(custom.notes ?? []), ...(origin.notes ?? [])])];
      return {
        value: { custom: custom.theme, origin: origin.theme },
        notes: notes.map((note) => `Working draft — ${note}`),
      };
    }
  } catch {
    // Falls through to preservation below.
  }
  // Keep it rather than let the next save overwrite it.
  if (read(STORAGE_KEYS.draftUnreadable) === null) write(STORAGE_KEYS.draftUnreadable, raw);
  return {
    value: null,
    notes: [`The working draft could not be read and was kept, unchanged, under ${STORAGE_KEYS.draftUnreadable}.`],
  };
}

export function saveDraft(draft: StoredDraft | null): void {
  if (draft === null) {
    write(STORAGE_KEYS.draft, null);
    return;
  }
  const encode = (theme: ThemeExport) => JSON.parse(toJson(theme)) as unknown;
  write(STORAGE_KEYS.draft, JSON.stringify({ custom: encode(draft.custom), origin: encode(draft.origin) }));
}

function rawSaved(): unknown[] {
  const raw = read(STORAGE_KEYS.saved);
  if (raw === null) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function loadSaved(original?: LegacyOriginal): Loaded<readonly ThemeExport[]> {
  const themes: ThemeExport[] = [];
  const notes: string[] = [];
  let unreadable = 0;
  for (const entry of rawSaved()) {
    const parsed = parseThemeJson(JSON.stringify(entry), original);
    if (!parsed.ok) {
      unreadable += 1;
      continue;
    }
    themes.push(parsed.theme);
    for (const note of parsed.notes ?? []) notes.push(`Saved "${parsed.theme.name}" — ${note}`);
  }
  if (unreadable > 0) {
    notes.push(
      `${String(unreadable)} saved experiment(s) could not be read. They are kept in storage, untouched, and are not listed.`,
    );
  }
  return { value: themes, notes };
}

/**
 * Writes the list in the current format, followed by every stored entry this
 * catalogue cannot read — verbatim, so saving or deleting one experiment
 * never erases another just because it is unreadable today.
 */
export function storeSaved(list: readonly ThemeExport[], original?: LegacyOriginal): void {
  const kept = rawSaved().filter((entry) => !parseThemeJson(JSON.stringify(entry), original).ok);
  const current = list.map((theme) => JSON.parse(toJson(theme)) as unknown);
  write(STORAGE_KEYS.saved, JSON.stringify([...current, ...kept]));
}
