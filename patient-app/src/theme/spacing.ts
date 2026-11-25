/**
 * Spacing, radius and elevation.
 *
 * The 4pt grid, the three radius decisions and the two-shadow vocabulary
 * are ported verbatim from `frontend/src/styles/tokens.css`. The web
 * tokens are rem strings; RN takes density-independent numbers, so each
 * value is the same measurement expressed as a number (1rem = 16).
 */

/** 4pt grid. `space[4]` is 16dp — the screen gutter. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export type SpaceToken = keyof typeof space;

/**
 * Three decisions, named for what they are — not a six-step t-shirt
 * ladder that never told you which to reach for (tokens.css, Wave 1b).
 */
export const radius = {
  control: 4,
  surface: 8,
  pill: 9999,
} as const;

/**
 * Elevation.
 *
 * The design carries elevation on a 1px border; only two things float.
 * A shadow has to be declared twice on RN — iOS reads `shadow*`, Android
 * reads `elevation` — so each entry is the object a `View` style spreads.
 * A card reaching for one of these is a card that wants a border.
 */
export const elevation = {
  popover: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  modal: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 12,
  },
} as const;

/**
 * The accessibility floor for anything a finger touches (WCAG 2.5.5,
 * Apple HIG 44pt, Material 48dp). Every pressable in `components/`
 * enforces it via `minHeight`/`minWidth` or a `hitSlop`; S-01 is the
 * checklist row and `components/components.test.tsx` ("clears the 44dp touch
 * floor at every size") is the assertion.
 */
export const MIN_TOUCH_TARGET = 44;

/** The standard horizontal screen gutter. */
export const SCREEN_GUTTER = space[4];
