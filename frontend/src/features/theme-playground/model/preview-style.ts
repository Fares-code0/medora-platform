import type { CSSProperties } from 'react';

import { COPIED_TOKEN_NAMES, COPIED_TOKENS, cssVar, WEB_TOKENS, type Palette } from './tokens';
import type { Mode } from './usePlayground';

/**
 * The inline style that turns a `<div>` into an isolated theme scope.
 *
 * Every Tailwind colour class resolves `var(--color-*)` from the nearest
 * element that declares it. Declaring ALL of them on the preview container
 * means everything inside paints from the playground's palette, whatever
 * `<html>` says — the app's own theme, `.dark` class and high-contrast
 * attribute included. Nothing is written to `<html>` or `:root`, so the
 * page around the preview, and every other tab, is untouched.
 *
 * The `--shadow-*` tokens are re-declared too. A custom property that
 * references another (`--shadow-focus: … var(--color-focus-ring)`) is
 * resolved where it is DECLARED — on `:root`, with the app's colours — and
 * inherited already computed. Re-declaring it here makes the focus ring and
 * the dark overlay outline follow the preview palette.
 *
 * Real scrollbars are deliberately NOT re-coloured here: globals.css is the
 * one place that does it (scrollbar-theme.test.ts holds it there). The
 * gallery paints the two scrollbar tokens as a sample instead.
 */
export function previewStyle(
  palette: Palette,
  mode: Mode,
  shadows: Readonly<Record<string, string>>,
): CSSProperties {
  const vars: Record<string, string> = {};
  for (const token of WEB_TOKENS) vars[cssVar(token)] = palette[token];
  // Copies are re-declared as the same reference tokens.css uses, so they
  // resolve HERE, against the playground's source value — declared only on
  // `:root`, they would arrive already computed from the app's colours.
  for (const name of COPIED_TOKEN_NAMES) vars[name] = `var(${COPIED_TOKENS[name].source})`;
  for (const [name, value] of Object.entries(shadows)) vars[`--shadow-${name}`] = value;
  return {
    ...vars,
    colorScheme: mode,
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-text-primary)',
  };
}
