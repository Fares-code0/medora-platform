/**
 * Motion tokens, ported from tokens.css.
 *
 * `useReducedMotion` (src/accessibility) collapses every duration below to
 * 0 when the OS reduce-motion switch is on. That is why durations are read
 * through the theme rather than written into components: one switch, one
 * place, and no animation can forget to honour it.
 */
export const duration = {
  fast: 100,
  base: 150,
  moderate: 200,
  slow: 250,
  entrance: 300,
} as const;

/** Per-item entrance delay for staggered lists. */
export const STAGGER_MS = 50;

export type DurationToken = keyof typeof duration;
