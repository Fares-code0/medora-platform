import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ThemeExport } from './export';
import { PRESETS, type PresetId, type ThemePreset } from './presets';
import { loadDraft, loadSaved, saveDraft, storeSaved, type StoredDraft } from './storage';
import type { Palette, WebToken } from './tokens';

export type Mode = 'light' | 'dark';
export type ActiveId = PresetId | 'custom';

/**
 * Playground state.
 *
 * Built-in presets are read-only. The first edit to any of them forks a
 * **Custom Theme** — a copy that remembers where it came from (`origin`), so
 * "reset" always has a defined target. Picking another preset afterwards
 * does NOT discard the custom theme; its card stays selectable until you
 * reset it. Editing a built-in while a custom theme exists would replace it,
 * so the page asks first (`wouldReplaceCustom`) — nothing an experiment does
 * is lost by a stray click.
 */
export interface PlaygroundState {
  readonly presets: readonly ThemePreset[];
  readonly active: ActiveId;
  /** The palette currently shown and exported. */
  readonly theme: ThemeExport;
  readonly custom: StoredDraft | null;
  readonly saved: readonly ThemeExport[];
  /**
   * What loading this browser's stored experiments migrated or preserved —
   * empty unless something was. Shown by the page, never applied silently.
   */
  readonly storageNotes: readonly string[];
  dismissStorageNotes: () => void;
  /** True when an edit now would fork a built-in over an existing custom theme. */
  readonly wouldReplaceCustom: boolean;
  selectPreset: (id: ActiveId) => void;
  setToken: (mode: Mode, token: WebToken, value: string) => void;
  resetToken: (mode: Mode, token: WebToken) => void;
  resetMode: (mode: Mode) => void;
  resetAll: () => void;
  /** The value `token` would reset to. */
  originValue: (mode: Mode, token: WebToken) => string;
  loadTheme: (theme: ThemeExport) => void;
  rename: (name: string) => void;
  saveCurrent: (name: string) => void;
  deleteSaved: (name: string) => void;
}

const asTheme = (preset: ThemePreset): ThemeExport => ({
  name: preset.label,
  light: preset.light,
  dark: preset.dark,
});

export function usePlayground(presets: readonly ThemePreset[] = PRESETS): PlaygroundState {
  // The shipped palettes fill roles a stored experiment predates entirely.
  const original = presets[0];
  const [initial] = useState(() => ({ draft: loadDraft(original), saved: loadSaved(original) }));
  const [custom, setCustom] = useState<StoredDraft | null>(initial.draft.value);
  const [active, setActive] = useState<ActiveId>(() => (initial.draft.value ? 'custom' : 'original'));
  const [saved, setSaved] = useState<readonly ThemeExport[]>(initial.saved.value);
  const [storageNotes, setStorageNotes] = useState<readonly string[]>(() => [
    ...initial.draft.notes,
    ...initial.saved.notes,
  ]);
  const dismissStorageNotes = useCallback(() => setStorageNotes([]), []);

  useEffect(() => {
    saveDraft(custom);
  }, [custom]);

  const presetTheme = useCallback(
    (id: PresetId): ThemeExport => asTheme(presets.find((p) => p.id === id) ?? presets[0]!),
    [presets],
  );

  const theme: ThemeExport = useMemo(
    () => (active === 'custom' && custom ? custom.custom : presetTheme(active === 'custom' ? 'original' : active)),
    [active, custom, presetTheme],
  );

  const selectPreset = useCallback(
    (id: ActiveId) => {
      if (id === 'custom' && !custom) {
        // Start a Custom Theme from whatever is on screen now.
        setCustom({ custom: { ...theme, name: 'Custom Theme' }, origin: theme });
      }
      setActive(id);
    },
    [custom, theme],
  );

  const setToken = useCallback(
    (mode: Mode, token: WebToken, value: string) => {
      setCustom((previous) => {
        // Editing a built-in forks it; editing the custom theme edits it.
        const base: StoredDraft =
          active === 'custom' && previous
            ? previous
            : { custom: { ...theme, name: `Custom (from ${theme.name})` }, origin: theme };
        const palette: Palette = { ...base.custom[mode], [token]: value };
        return { ...base, custom: { ...base.custom, [mode]: palette } };
      });
      setActive('custom');
    },
    [active, theme],
  );

  const originValue = useCallback(
    (mode: Mode, token: WebToken) =>
      (active === 'custom' && custom ? custom.origin : theme)[mode][token],
    [active, custom, theme],
  );

  const resetToken = useCallback(
    (mode: Mode, token: WebToken) => {
      if (active !== 'custom' || !custom) return;
      setCustom({
        ...custom,
        custom: { ...custom.custom, [mode]: { ...custom.custom[mode], [token]: custom.origin[mode][token] } },
      });
    },
    [active, custom],
  );

  const resetMode = useCallback(
    (mode: Mode) => {
      if (active !== 'custom' || !custom) return;
      setCustom({ ...custom, custom: { ...custom.custom, [mode]: custom.origin[mode] } });
    },
    [active, custom],
  );

  const resetAll = useCallback(() => {
    setCustom(null);
    setActive('original');
  }, []);

  const loadTheme = useCallback((next: ThemeExport) => {
    setCustom({ custom: next, origin: next });
    setActive('custom');
  }, []);

  const rename = useCallback(
    (name: string) => {
      if (!custom) return;
      setCustom({ ...custom, custom: { ...custom.custom, name } });
    },
    [custom],
  );

  const saveCurrent = useCallback(
    (name: string) => {
      const entry: ThemeExport = { ...theme, name };
      const next = [...saved.filter((s) => s.name !== name), entry];
      setSaved(next);
      storeSaved(next, original);
    },
    [saved, theme, original],
  );

  const deleteSaved = useCallback(
    (name: string) => {
      const next = saved.filter((s) => s.name !== name);
      setSaved(next);
      storeSaved(next, original);
    },
    [saved, original],
  );

  return {
    presets,
    active,
    theme,
    custom,
    saved,
    storageNotes,
    dismissStorageNotes,
    wouldReplaceCustom: active !== 'custom' && custom !== null,
    selectPreset,
    setToken,
    resetToken,
    resetMode,
    resetAll,
    originValue,
    loadTheme,
    rename,
    saveCurrent,
    deleteSaved,
  };
}
