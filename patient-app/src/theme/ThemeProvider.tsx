import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useColorScheme } from 'react-native';

import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';

import { duration, STAGGER_MS } from './motion';
import { elevation, MIN_TOUCH_TARGET, radius, SCREEN_GUTTER, space } from './spacing';
import { darkColors, lightColors, type ColorPalette } from './tokens';
import { buildTypography, type Typography } from './typography';

/**
 * Theme.
 *
 * Three modes, not two: **light**, **dark** and **system**. "System" is
 * the default and is a distinct stored value — collapsing it to whichever
 * palette the OS happened to be showing at first launch is how an app
 * stops following the OS the moment the patient opens it.
 *
 * Colours are only ever read from here. A hex literal inside a screen is
 * a value that cannot follow the theme, which is the single largest cause
 * of the dark-mode failures §8 of the brief enumerates — black text on a
 * dark surface, a border that vanishes, a disabled state that reads as
 * enabled. The ESLint boundary rules stop `screens/` importing `tokens.ts`
 * directly; `useTheme()` is the only route.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

export interface Theme {
  readonly scheme: ResolvedScheme;
  readonly colors: ColorPalette;
  readonly typography: Typography;
  readonly space: typeof space;
  readonly radius: typeof radius;
  readonly elevation: typeof elevation;
  readonly duration: typeof duration;
  readonly staggerMs: number;
  readonly minTouchTarget: number;
  readonly screenGutter: number;
}

interface ThemeContextValue {
  readonly theme: Theme;
  readonly mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readStoredMode(): ThemeMode {
  const stored = preferenceStore.get(PREFERENCE_KEYS.themeMode);
  return isThemeMode(stored) ? stored : 'system';
}

export function buildTheme(scheme: ResolvedScheme): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    typography: buildTypography(),
    space,
    radius,
    elevation,
    duration,
    staggerMs: STAGGER_MS,
    minTouchTarget: MIN_TOUCH_TARGET,
    screenGutter: SCREEN_GUTTER,
  };
}

export function ThemeProvider({
  children,
  initialMode,
}: {
  children: ReactNode;
  /** Test seam. Production reads the stored preference. */
  initialMode?: ThemeMode;
}) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(() => initialMode ?? readStoredMode());

  const setMode = useCallback((next: ThemeMode) => {
    preferenceStore.set(PREFERENCE_KEYS.themeMode, next);
    setModeState(next);
  }, []);

  // `useColorScheme()` returns null before the OS reports one; treating
  // that as "dark" would flash a dark screen on a light phone.
  const resolved: ResolvedScheme =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: buildTheme(resolved), mode, setMode }),
    [resolved, mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside <ThemeProvider>.');
  }
  return value;
}

/** The only way a component reads a colour, a space or a duration. */
export function useTheme(): Theme {
  return useThemeContext().theme;
}
