import tokensCss from '@/styles/tokens.css?raw';

import type { Palette } from './tokens';
import { parseTokensCss } from './tokens-css';

/**
 * Theme Playground presets — the WEB copy.
 *
 * ── Two copies, on purpose ───────────────────────────────────────────
 * The patient app holds the same palettes, as `ColorPalette` objects, in
 * `patient-app/src/features/theme-playground/model/presets.ts`. There is no
 * shared runtime package between the two apps, and adding one for a dev
 * tool would be the wrong trade. Instead the copies are kept honest by
 * `patient-parity.test.ts` (this folder), which fails if any shared token
 * differs between them. Edit one, edit the other, run that test.
 *
 * ── Rules every preset keeps ─────────────────────────────────────────
 * - Status colours (success/warning/error/info) are IDENTICAL in every
 *   preset. They carry clinical meaning; a palette is a brand decision and
 *   does not get to change what "error" looks like.
 * - The AI accent stays >= 40 degrees of hue away from primary, so AI
 *   provenance never reads as an ordinary brand control.
 * - Every text, boundary and filled-tone pair clears the thresholds in
 *   `contrast-rules.ts` — `presets.test.ts` runs them against all of these.
 *
 * "Original Medora" is not written out here: it is parsed from tokens.css,
 * so it is always exactly what the app ships.
 */

export type PresetId = 'original' | 'medical-blue' | 'midnight-purple' | 'emerald-green';

export interface ThemePreset {
  readonly id: PresetId;
  readonly label: string;
  readonly description: string;
  readonly light: Palette;
  readonly dark: Palette;
}


/* Status: shared by every preset (see the header). Values from tokens.css. */
const STATUS_LIGHT = {
  '--color-success': '#136c35',
  '--color-success-subtle': '#ecf6f0',
  '--color-warning': '#8a5600',
  '--color-warning-subtle': '#fdf4e3',
  '--color-error': '#c0271f',
  '--color-error-hover': '#9d1f18',
  '--color-error-subtle': '#fcefee',
  '--color-info': '#0c6291',
  '--color-info-subtle': '#ecf4fa',
} as const;

const STATUS_DARK = {
  '--color-success': '#6fc48d',
  '--color-success-subtle': 'rgba(111, 196, 141, 0.16)',
  '--color-warning': '#e0b055',
  '--color-warning-subtle': 'rgba(224, 176, 85, 0.16)',
  '--color-error': '#f0908a',
  '--color-error-hover': '#f5aca7',
  '--color-error-subtle': 'rgba(240, 144, 138, 0.16)',
  '--color-info': '#6fb6dd',
  '--color-info-subtle': 'rgba(111, 182, 221, 0.16)',
} as const;

/*
  Sidebar (ADR-0005): charcoal in both modes in every preset, as in tokens.css.
  The active item takes the preset's DARK-mode primary with ink on it — the
  rail is a dark ground in either mode, and a light-mode primary is too dark
  to stand 3:1 off it.
*/
const sidebar = (active: string) =>
  ({
    '--color-sidebar': '#0b0d0f',
    '--color-sidebar-raised': '#111519',
    '--color-sidebar-hover': '#1b252e',
    '--color-sidebar-border': '#1b252e',
    '--color-sidebar-text': '#f5f7fa',
    '--color-sidebar-text-muted': '#a5afba',
    '--color-sidebar-active': active,
    '--color-sidebar-active-text': '#0b0d0f',
  }) as const;

/*
  The navbar Medora AI button (ADR-0005 §11): a white tile with a black edge
  in both modes in every preset, as in tokens.css.
*/
const AI_LAUNCHER = {
  '--color-ai-launcher': '#ffffff',
  '--color-ai-launcher-border': '#0b0d0f',
} as const;

const MEDICAL_BLUE: ThemePreset = {
  id: 'medical-blue',
  label: 'Medical Blue',
  description: 'A brighter, clearer clinical blue on cool neutral grounds.',
  light: {
    '--color-primary': '#0b5cad',
    '--color-primary-hover': '#094a8c',
    '--color-primary-pressed': '#073a6e',
    '--color-primary-subtle': '#e8f1fb',
    '--color-primary-fill': '#0b5cad',
    '--color-primary-fill-hover': '#094a8c',
    '--color-primary-fill-text': '#ffffff',
    '--color-accent': '#7d4f86',
    '--color-accent-subtle': '#f4eff6',
    '--color-ai-badge': '#f4eff6',
    '--color-ai-badge-text': '#7d4f86',
    '--color-background': '#f4f7fb',
    '--color-surface': '#ffffff',
    '--color-surface-sunken': '#edf1f7',
    '--color-surface-overlay': '#ffffff',
    '--color-text-primary': '#0b1726',
    '--color-text-secondary': '#334155',
    '--color-text-tertiary': '#526073',
    '--color-text-placeholder': '#5f6b7d',
    '--color-text-disabled': '#7b8798',
    '--color-text-inverse': '#ffffff',
    '--color-border': '#d0d9e4',
    '--color-border-strong': '#7b8798',
    '--color-focus-ring': '#0b5cad',
    '--color-scrim': 'rgba(4, 18, 38, 0.55)',
    '--color-control-knob': '#ffffff',
    '--color-scrollbar-track': 'transparent',
    ...sidebar('#8cbcf0'),
    ...AI_LAUNCHER,
    '--color-tab-active-text': '#0b1726',
    '--color-tab-indicator': '#0b5cad',
    ...STATUS_LIGHT,
    '--color-chart-1': '#0b4a8c',
    '--color-chart-1-edge': '#06264a',
    '--color-chart-2': '#5a5fb8',
    '--color-chart-2-edge': '#3a3f96',
    '--color-chart-3': '#4f93d1',
    '--color-chart-3-edge': '#22679f',
    '--color-chart-4': '#a9b4e0',
    '--color-chart-4-edge': '#6f7fcb',
    '--color-chart-5': '#c8e0f2',
    '--color-chart-5-edge': '#4592cf',
  },
  dark: {
    '--color-primary': '#8cbcf0',
    '--color-primary-hover': '#a8cdf4',
    '--color-primary-pressed': '#75aae6',
    '--color-primary-subtle': 'rgba(140, 188, 240, 0.16)',
    '--color-primary-fill': '#8cbcf0',
    '--color-primary-fill-hover': '#a8cdf4',
    '--color-primary-fill-text': '#0b0f15',
    '--color-accent': '#b998c2',
    '--color-accent-subtle': 'rgba(185, 152, 194, 0.16)',
    '--color-ai-badge': 'rgba(185, 152, 194, 0.16)',
    '--color-ai-badge-text': '#b998c2',
    '--color-background': '#0b0f15',
    '--color-surface': '#151b24',
    '--color-surface-sunken': '#10151c',
    '--color-surface-overlay': '#1f2733',
    '--color-text-primary': '#f2f5f9',
    '--color-text-secondary': '#c5cdd8',
    '--color-text-tertiary': '#98a3b3',
    '--color-text-placeholder': '#808b9b',
    '--color-text-disabled': '#687588',
    '--color-text-inverse': '#0b0f15',
    '--color-border': '#29323f',
    '--color-border-strong': '#687588',
    '--color-focus-ring': '#8cbcf0',
    '--color-scrim': 'rgba(0, 0, 0, 0.72)',
    '--color-control-knob': '#ffffff',
    '--color-scrollbar-track': 'transparent',
    ...sidebar('#8cbcf0'),
    ...AI_LAUNCHER,
    '--color-tab-active-text': '#f2f5f9',
    '--color-tab-indicator': '#8cbcf0',
    ...STATUS_DARK,
    '--color-chart-1': '#cfe2f6',
    '--color-chart-1-edge': '#8cb2dc',
    '--color-chart-2': '#b0b3e2',
    '--color-chart-2-edge': '#8086c2',
    '--color-chart-3': '#4f93d1',
    '--color-chart-3-edge': '#9cc0e2',
    '--color-chart-4': '#5f66b9',
    '--color-chart-4-edge': '#8f94c6',
    '--color-chart-5': '#1f4f77',
    '--color-chart-5-edge': '#4a80ad',
  },
};

const MIDNIGHT_PURPLE: ThemePreset = {
  id: 'midnight-purple',
  label: 'Midnight Purple',
  description: 'Deep violet brand; the AI accent moves to magenta to stay distinct.',
  light: {
    '--color-primary': '#5b3fa8',
    '--color-primary-hover': '#4a3290',
    '--color-primary-pressed': '#3a2672',
    '--color-primary-subtle': '#f1edfa',
    '--color-primary-fill': '#5b3fa8',
    '--color-primary-fill-hover': '#4a3290',
    '--color-primary-fill-text': '#ffffff',
    '--color-accent': '#973b8c',
    '--color-accent-subtle': '#f8edf6',
    '--color-ai-badge': '#f8edf6',
    '--color-ai-badge-text': '#973b8c',
    '--color-background': '#f6f5fa',
    '--color-surface': '#ffffff',
    '--color-surface-sunken': '#f0eef6',
    '--color-surface-overlay': '#ffffff',
    '--color-text-primary': '#17122b',
    '--color-text-secondary': '#3f3a52',
    '--color-text-tertiary': '#5c5670',
    '--color-text-placeholder': '#6a6480',
    '--color-text-disabled': '#847e96',
    '--color-text-inverse': '#ffffff',
    '--color-border': '#d8d4e4',
    '--color-border-strong': '#847e96',
    '--color-focus-ring': '#5b3fa8',
    '--color-scrim': 'rgba(23, 18, 43, 0.55)',
    '--color-control-knob': '#ffffff',
    '--color-scrollbar-track': 'transparent',
    ...sidebar('#b4a2f0'),
    ...AI_LAUNCHER,
    '--color-tab-active-text': '#17122b',
    '--color-tab-indicator': '#5b3fa8',
    ...STATUS_LIGHT,
    '--color-chart-1': '#3f2d86',
    '--color-chart-1-edge': '#1f1450',
    '--color-chart-2': '#6a5caf',
    '--color-chart-2-edge': '#44358f',
    '--color-chart-3': '#8f7fd0',
    '--color-chart-3-edge': '#5f4fb0',
    '--color-chart-4': '#bfb3e6',
    '--color-chart-4-edge': '#8172c8',
    '--color-chart-5': '#ddd6f3',
    '--color-chart-5-edge': '#8a79d2',
  },
  dark: {
    '--color-primary': '#b4a2f0',
    '--color-primary-hover': '#c7b9f5',
    '--color-primary-pressed': '#a08ce6',
    '--color-primary-subtle': 'rgba(180, 162, 240, 0.16)',
    '--color-primary-fill': '#b4a2f0',
    '--color-primary-fill-hover': '#c7b9f5',
    '--color-primary-fill-text': '#0e0b16',
    '--color-accent': '#e3a6d6',
    '--color-accent-subtle': 'rgba(227, 166, 214, 0.16)',
    '--color-ai-badge': 'rgba(227, 166, 214, 0.16)',
    '--color-ai-badge-text': '#e3a6d6',
    '--color-background': '#0e0b16',
    '--color-surface': '#1a1624',
    '--color-surface-sunken': '#14111c',
    '--color-surface-overlay': '#251f31',
    '--color-text-primary': '#f3f0fa',
    '--color-text-secondary': '#cdc6da',
    '--color-text-tertiary': '#a39bb3',
    '--color-text-placeholder': '#8b8399',
    '--color-text-disabled': '#757087',
    '--color-text-inverse': '#0e0b16',
    '--color-border': '#30293f',
    '--color-border-strong': '#757087',
    '--color-focus-ring': '#b4a2f0',
    '--color-scrim': 'rgba(0, 0, 0, 0.72)',
    '--color-control-knob': '#ffffff',
    '--color-scrollbar-track': 'transparent',
    ...sidebar('#b4a2f0'),
    ...AI_LAUNCHER,
    '--color-tab-active-text': '#f3f0fa',
    '--color-tab-indicator': '#b4a2f0',
    ...STATUS_DARK,
    '--color-chart-1': '#ddd5f6',
    '--color-chart-1-edge': '#a395d9',
    '--color-chart-2': '#b2aada',
    '--color-chart-2-edge': '#877eb6',
    '--color-chart-3': '#8a78d6',
    '--color-chart-3-edge': '#b3a6e6',
    '--color-chart-4': '#5f4fb0',
    '--color-chart-4-edge': '#8d80c8',
    '--color-chart-5': '#3a2f6e',
    '--color-chart-5-edge': '#6a5cb0',
  },
};

const EMERALD_GREEN: ThemePreset = {
  id: 'emerald-green',
  label: 'Emerald Green',
  description: 'Emerald brand, blue secondary, teal chart ramp clear of success green.',
  light: {
    '--color-primary': '#0d6b50',
    '--color-primary-hover': '#0a5640',
    '--color-primary-pressed': '#074231',
    '--color-primary-subtle': '#e8f4ef',
    '--color-primary-fill': '#0d6b50',
    '--color-primary-fill-hover': '#0a5640',
    '--color-primary-fill-text': '#ffffff',
    '--color-accent': '#7d4f86',
    '--color-accent-subtle': '#f4eff6',
    '--color-ai-badge': '#f4eff6',
    '--color-ai-badge-text': '#7d4f86',
    '--color-background': '#f4f8f6',
    '--color-surface': '#ffffff',
    '--color-surface-sunken': '#edf3f0',
    '--color-surface-overlay': '#ffffff',
    '--color-text-primary': '#0c1a14',
    '--color-text-secondary': '#33453d',
    '--color-text-tertiary': '#4f6259',
    '--color-text-placeholder': '#5c6f66',
    '--color-text-disabled': '#7a8a82',
    '--color-text-inverse': '#ffffff',
    '--color-border': '#cdd9d3',
    '--color-border-strong': '#7a8a82',
    '--color-focus-ring': '#0d6b50',
    '--color-scrim': 'rgba(6, 26, 19, 0.55)',
    '--color-control-knob': '#ffffff',
    '--color-scrollbar-track': 'transparent',
    ...sidebar('#6fd1ad'),
    ...AI_LAUNCHER,
    '--color-tab-active-text': '#0c1a14',
    '--color-tab-indicator': '#0d6b50',
    ...STATUS_LIGHT,
    '--color-chart-1': '#0f5a66',
    '--color-chart-1-edge': '#062f36',
    '--color-chart-2': '#2f7f8f',
    '--color-chart-2-edge': '#1b5a66',
    '--color-chart-3': '#4f9fb8',
    '--color-chart-3-edge': '#2a7590',
    '--color-chart-4': '#a6d0dc',
    '--color-chart-4-edge': '#4d93a9',
    '--color-chart-5': '#d2e9ef',
    '--color-chart-5-edge': '#4f9cb4',
  },
  dark: {
    '--color-primary': '#6fd1ad',
    '--color-primary-hover': '#8fdcbf',
    '--color-primary-pressed': '#58c09a',
    '--color-primary-subtle': 'rgba(111, 209, 173, 0.16)',
    '--color-primary-fill': '#6fd1ad',
    '--color-primary-fill-hover': '#8fdcbf',
    '--color-primary-fill-text': '#0b100e',
    '--color-accent': '#b998c2',
    '--color-accent-subtle': 'rgba(185, 152, 194, 0.16)',
    '--color-ai-badge': 'rgba(185, 152, 194, 0.16)',
    '--color-ai-badge-text': '#b998c2',
    '--color-background': '#0b100e',
    '--color-surface': '#151c19',
    '--color-surface-sunken': '#101613',
    '--color-surface-overlay': '#1f2824',
    '--color-text-primary': '#f1f6f3',
    '--color-text-secondary': '#c4d0ca',
    '--color-text-tertiary': '#97a59e',
    '--color-text-placeholder': '#7f8d86',
    '--color-text-disabled': '#68786f',
    '--color-text-inverse': '#0b100e',
    '--color-border': '#2a3530',
    '--color-border-strong': '#68786f',
    '--color-focus-ring': '#6fd1ad',
    '--color-scrim': 'rgba(0, 0, 0, 0.72)',
    '--color-control-knob': '#ffffff',
    '--color-scrollbar-track': 'transparent',
    ...sidebar('#6fd1ad'),
    ...AI_LAUNCHER,
    '--color-tab-active-text': '#f1f6f3',
    '--color-tab-indicator': '#6fd1ad',
    ...STATUS_DARK,
    '--color-chart-1': '#cdebf0',
    '--color-chart-1-edge': '#8cc3cf',
    '--color-chart-2': '#9fd3dd',
    '--color-chart-2-edge': '#6fadbb',
    '--color-chart-3': '#4f9fb8',
    '--color-chart-3-edge': '#93c6d6',
    '--color-chart-4': '#2f7f8f',
    '--color-chart-4-edge': '#5fa4b3',
    '--color-chart-5': '#1d4f59',
    '--color-chart-5-edge': '#3f7f8b',
  },
};

/**
 * The preset list for a given tokens.css text. A function of the stylesheet
 * rather than a constant so tests can hand it the file read from disk —
 * Vitest stubs every CSS import, `?raw` included, to an empty string.
 */
export function buildPresets(css: string): readonly ThemePreset[] {
  const parsed = parseTokensCss(css);
  return [
    {
      id: 'original',
      label: 'Original Medora',
      description: 'Exactly what tokens.css ships — edit that file and this follows.',
      light: parsed.light,
      dark: parsed.dark,
    },
    MEDICAL_BLUE,
    MIDNIGHT_PURPLE,
    EMERALD_GREEN,
  ];
}

/** Re-read on every Vite reload of tokens.css, so manual edits show up here. */
export const PRESETS = buildPresets(tokensCss);

/** The shadow declarations of tokens.css, per mode — re-declared by the preview. */
export const TOKEN_SHADOWS = parseTokensCss(tokensCss).shadows;

export function presetById(id: PresetId, presets: readonly ThemePreset[] = PRESETS): ThemePreset {
  return presets.find((preset) => preset.id === id) ?? (presets[0] as ThemePreset);
}
