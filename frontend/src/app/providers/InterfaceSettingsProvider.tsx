import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  DEFAULT_INTERFACE_SETTINGS,
  getPreference,
  setPreference,
  type InterfaceSettings,
} from '@/services/preferences';

/**
 * Interface settings provider — appearance + accessibility, mirroring
 * ThemeProvider's shape. Persists via the global `interface` preference and
 * reflects each choice onto <html> (data attributes + the `--font-scale`
 * custom property) so the whole document follows. The no-flash boot script
 * in index.html applies the same attributes before React mounts; this
 * provider keeps them in sync afterwards. Mounted above MotionProvider so
 * the global motion policy can read `reduceMotion`.
 */

export const TEXT_SCALE_MIN = 90;
export const TEXT_SCALE_MAX = 130;

interface InterfaceSettingsContextValue {
  readonly settings: InterfaceSettings;
  readonly update: (patch: Partial<InterfaceSettings>) => void;
  readonly reset: () => void;
}

const InterfaceSettingsContext = createContext<InterfaceSettingsContextValue | null>(null);

function clampScale(value: number): number {
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, Math.round(value)));
}

/** Reflect settings onto the document root — mirrors the index.html boot script. */
function applyInterfaceSettings(settings: InterfaceSettings): void {
  const root = document.documentElement;
  root.dataset['density'] = settings.density;
  root.dataset['contrast'] = settings.highContrast ? 'high' : 'normal';
  root.dataset['focus'] = settings.focusRings;
  root.dataset['keyboardNav'] = settings.keyboardNav ? 'on' : 'off';
  root.dataset['reduceMotion'] = settings.reduceMotion ? 'on' : 'off';
  root.style.setProperty('--font-scale', String(settings.textScale / 100));
}

export function InterfaceSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<InterfaceSettings>(
    () => getPreference('interface') ?? DEFAULT_INTERFACE_SETTINGS,
  );

  useEffect(() => {
    applyInterfaceSettings(settings);
  }, [settings]);

  const persist = useCallback((next: InterfaceSettings) => {
    setSettings(next);
    setPreference('interface', next);
  }, []);

  const update = useCallback(
    (patch: Partial<InterfaceSettings>) => {
      setSettings((previous) => {
        const next: InterfaceSettings = {
          ...previous,
          ...patch,
          textScale: patch.textScale === undefined ? previous.textScale : clampScale(patch.textScale),
        };
        setPreference('interface', next);
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => {
    persist(DEFAULT_INTERFACE_SETTINGS);
  }, [persist]);

  const value = useMemo<InterfaceSettingsContextValue>(
    () => ({ settings, update, reset }),
    [settings, update, reset],
  );

  return (
    <InterfaceSettingsContext.Provider value={value}>
      {children}
    </InterfaceSettingsContext.Provider>
  );
}

export function useInterfaceSettings(): InterfaceSettingsContextValue {
  const ctx = useContext(InterfaceSettingsContext);
  if (!ctx) throw new Error('useInterfaceSettings must be used within InterfaceSettingsProvider');
  return ctx;
}
