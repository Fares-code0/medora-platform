import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/utils/cn';

import { MEDORA_GLYPHS, MEDORA_LOCKUP_VIEWBOX, MEDORA_MARK_VIEWBOX } from './medoraLogoPaths';

/**
 * Medora logo — the official application mark, drawn from the approved
 * artwork (`medoraLogoPaths.ts`).
 *
 * Its signature is the `d·o` ligature: the two letters merge into one
 * continuous figure-eight, the left loop reading as the `d` bowl and the right
 * as the `o`, the two ribbons passing behind each other at the crossing. That
 * ligature is also the standalone symbol — `variant="mark"` renders it alone
 * (favicon, PWA icon, avatar, tight rails).
 *
 * Colour: by default the mark inherits `currentColor`, so it adapts to the
 * surrounding theme (dark ink in light mode, light ink in dark mode). Pass
 * `color` to force a fixed brand value on coloured surfaces.
 *
 * The artwork is filled outlines, not strokes, so it holds its weight at every
 * size instead of thinning as it scales down.
 */

export type LogoSize = 'sm' | 'md' | 'lg';
export type LogoColor = 'dark' | 'light' | 'primary';
export type LogoVariant = 'lockup' | 'mark';

export interface LogoProps {
  /** Wordmark height preset. sm ≈ 18px, md ≈ 24px, lg ≈ 34px. Default `md`. */
  size?: LogoSize;
  /**
   * `lockup` renders the full `Medora` wordmark; `mark` renders the `d·o`
   * ligature alone. Default `lockup`.
   *
   * The two are the same artwork but not the same crop: the mark's viewBox is
   * the tighter of the two, so at a given `size` the ligature draws a little
   * larger standing alone than it does inside the word. That is the artwork's
   * own framing — a mark on its own needs to fill its box.
   */
  variant?: LogoVariant;
  /**
   * Fixed brand colour. Omit to inherit `currentColor` (theme-aware) — the
   * right choice for most in-app placements.
   */
  color?: LogoColor;
  className?: string;
  /**
   * Accessible name. When provided the mark is exposed as an image with this
   * label (use on the clickable home link). Omit to render it decoratively.
   */
  label?: string;
  /**
   * Leading slot rendered before the wordmark with prepared spacing. Reserved
   * for pairings the lockup itself cannot express (a clinic sub-brand, say) —
   * the Medora symbol is `variant="mark"`, not something to pass in here.
   */
  icon?: ReactNode;
}

const HEIGHTS: Record<LogoSize, number> = { sm: 18, md: 24, lg: 34 };

const BRAND_COLOR: Record<LogoColor, string> = {
  primary: '#111111',
  dark: '#000000',
  light: '#FFFFFF',
};

/**
 * width ÷ height of a `min-x min-y width height` viewBox, so a caller can give
 * the logo a height and let the width follow. Derived here rather than stated
 * in `medoraLogoPaths.ts`, which is generated: re-vectorising the artwork
 * replaces that file wholesale, and a hand-added constant would go with it.
 */
function aspectOf(viewBox: string): number {
  const [, , width = 0, height = 1] = viewBox.split(' ').map(Number);
  return width / height;
}

const LOCKUP_ASPECT = aspectOf(MEDORA_LOCKUP_VIEWBOX);
const MARK_ASPECT = aspectOf(MEDORA_MARK_VIEWBOX);

/** Lockup order is the reading order: M e (d·o) r a. */
const LOCKUP_GLYPHS: readonly string[] = [
  MEDORA_GLYPHS.M,
  MEDORA_GLYPHS.e,
  MEDORA_GLYPHS.ligature,
  MEDORA_GLYPHS.r,
  MEDORA_GLYPHS.a,
];

export function Logo({
  size = 'md',
  variant = 'lockup',
  color,
  className,
  label,
  icon,
}: LogoProps) {
  const isMark = variant === 'mark';
  const height = HEIGHTS[size];
  const width = Math.round(height * (isMark ? MARK_ASPECT : LOCKUP_ASPECT));
  const decorative = label === undefined;
  const style: CSSProperties | undefined = color ? { color: BRAND_COLOR[color] } : undefined;

  return (
    <span
      className={cn('inline-flex items-center', icon ? 'gap-2.5' : undefined, className)}
      style={style}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {icon}
        </span>
      ) : null}
      <svg
        width={width}
        height={height}
        viewBox={isMark ? MEDORA_MARK_VIEWBOX : MEDORA_LOCKUP_VIEWBOX}
        fill="currentColor"
        fillRule="evenodd"
        className="block shrink-0"
        shapeRendering="geometricPrecision"
        focusable="false"
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : label}
      >
        {(isMark ? [MEDORA_GLYPHS.ligature] : LOCKUP_GLYPHS).map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
