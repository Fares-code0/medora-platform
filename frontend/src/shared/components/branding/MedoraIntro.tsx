import { useCallback, useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';

import { MEDORA_INTRO_TIMING, markMedoraIntroPlayed, prefersReducedMotion } from './intro-session';
import {
  MEDORA_GLYPHS,
  MEDORA_LOCKUP_VIEWBOX,
  MEDORA_MARK_CENTERLINES,
  MEDORA_TRACE_LENGTHS,
  MEDORA_TRACE_WIDTH,
} from './medoraLogoPaths';

import './MedoraIntro.css';

/** Feeds each traced path its own dash length; the keyframe animates it to 0. */
const traceLength = (length: number) => ({ '--mi-trace-len': length }) as CSSProperties;

/** How long the skipped run takes to fade — matches `[data-skipping]` in the CSS. */
const SKIP_DURATION = 240;

export interface MedoraIntroProps {
  /**
   * Fires as the overlay starts to fade. Not a cue to fade content in: content
   * under the intro must already be painted at full opacity, or it has no
   * Largest Contentful Paint (DEC-012).
   */
  onReveal?: () => void;
  /** Fires once the overlay has finished leaving. */
  onFinish?: () => void;
  /** Let a tap or a key press cut the sequence short. Defaults to true. */
  allowSkip?: boolean;
}

/**
 * Medora's entrance. Renders a full-bleed overlay in the app's own surface
 * colour, draws the mark out of its own crossing point, reveals the wordmark
 * outward from it, and leaves.
 *
 * The whole sequence is CSS, so it runs on the compositor and never competes
 * with React's first render. See MedoraIntro.css for the timeline.
 */
export function MedoraIntro({ onReveal, onFinish, allowSkip = true }: MedoraIntroProps) {
  const uid = useId().replace(/:/g, '');
  const markMask = `medora-mark-${uid}`;
  const glintMask = `medora-glint-${uid}`;
  const wipeLeft = `medora-wipe-l-${uid}`;
  const wipeRight = `medora-wipe-r-${uid}`;

  const [skipping, setSkipping] = useState(false);
  const [gone, setGone] = useState(false);

  const skip = useCallback(() => setSkipping(true), []);

  // Normal run: reveal the app, then unmount.
  useEffect(() => {
    if (skipping) return;
    const timing = prefersReducedMotion() ? MEDORA_INTRO_TIMING.reduced : MEDORA_INTRO_TIMING.full;

    const revealTimer = window.setTimeout(() => onReveal?.(), timing.reveal);
    const finishTimer = window.setTimeout(() => {
      markMedoraIntroPlayed();
      setGone(true);
      onFinish?.();
    }, timing.total);

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(finishTimer);
    };
  }, [skipping, onReveal, onFinish]);

  // Skipped run: same two beats, compressed.
  useEffect(() => {
    if (!skipping) return;
    onReveal?.();
    const timer = window.setTimeout(() => {
      markMedoraIntroPlayed();
      setGone(true);
      onFinish?.();
    }, SKIP_DURATION);
    return () => window.clearTimeout(timer);
  }, [skipping, onReveal, onFinish]);

  useEffect(() => {
    if (!allowSkip || skipping) return;
    const handle = () => skip();
    window.addEventListener('pointerdown', handle, { once: true });
    window.addEventListener('keydown', handle, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handle);
      window.removeEventListener('keydown', handle);
    };
  }, [allowSkip, skipping, skip]);

  if (gone) return null;

  return (
    <div className="medora-intro" data-skipping={skipping || undefined} aria-hidden="true">
      <svg
        className="medora-intro__logo"
        viewBox={MEDORA_LOCKUP_VIEWBOX}
        fill="currentColor"
        fillRule="evenodd"
        focusable="false"
      >
        <defs>
          {/* The mark's own centrelines, stroked wide enough to uncover the
              outline and narrow enough to stay on its side of the crossing. */}
          <mask id={markMask} maskUnits="userSpaceOnUse" x="790" y="710" width="720" height="500">
            <rect className="medora-intro__seal" x="790" y="710" width="720" height="500" />
            <path
              className="medora-intro__trace medora-intro__trace--left"
              d={MEDORA_MARK_CENTERLINES.left}
              strokeWidth={MEDORA_TRACE_WIDTH}
              style={traceLength(MEDORA_TRACE_LENGTHS.left)}
            />
            <path
              className="medora-intro__trace medora-intro__trace--right"
              d={MEDORA_MARK_CENTERLINES.right}
              strokeWidth={MEDORA_TRACE_WIDTH}
              style={traceLength(MEDORA_TRACE_LENGTHS.right)}
            />
            <path
              className="medora-intro__trace medora-intro__trace--stem"
              d={MEDORA_MARK_CENTERLINES.stem}
              strokeWidth={MEDORA_TRACE_WIDTH}
              style={traceLength(MEDORA_TRACE_LENGTHS.stem)}
            />
          </mask>

          {/* The loop. The same two centrelines the mark was drawn along, now
              carrying a short travelling band instead of a growing one — the
              left lobe first, then the right, which together are one circuit
              of the figure-eight. No rect here: an unpainted mask is black,
              so only the band shows through. */}
          <mask id={glintMask} maskUnits="userSpaceOnUse" x="790" y="710" width="720" height="500">
            <path
              className="medora-intro__glint medora-intro__glint--left"
              d={MEDORA_MARK_CENTERLINES.left}
              strokeWidth={MEDORA_TRACE_WIDTH}
            />
            <path
              className="medora-intro__glint medora-intro__glint--right"
              d={MEDORA_MARK_CENTERLINES.right}
              strokeWidth={MEDORA_TRACE_WIDTH}
            />
          </mask>

          {/* Wordmark wipes: both start at the crossing and travel outward. */}
          <mask id={wipeLeft} maskUnits="userSpaceOnUse" x="100" y="730" width="1800" height="470">
            <rect
              className="medora-intro__wipe medora-intro__wipe--left"
              x="118"
              y="740"
              width="1010"
              height="451"
            />
          </mask>
          <mask id={wipeRight} maskUnits="userSpaceOnUse" x="100" y="730" width="1800" height="470">
            <rect
              className="medora-intro__wipe medora-intro__wipe--right"
              x="1128"
              y="740"
              width="753"
              height="451"
            />
          </mask>
        </defs>

        <g className="medora-intro__mark" mask={`url(#${markMask})`}>
          <path d={MEDORA_GLYPHS.ligature} />
        </g>

        {/* Full-ink copy of the same ligature, shown only where the travelling
            band is. The mark underneath drops to `--mi-mark-dim` while this
            runs, so the band reads as light moving through the loop. */}
        <g className="medora-intro__mark-glint" mask={`url(#${glintMask})`}>
          <path d={MEDORA_GLYPHS.ligature} />
        </g>

        <g mask={`url(#${wipeLeft})`}>
          <g className="medora-intro__letters medora-intro__letters--left">
            <path d={MEDORA_GLYPHS.M} />
            <path d={MEDORA_GLYPHS.e} />
          </g>
        </g>

        <g mask={`url(#${wipeRight})`}>
          <g className="medora-intro__letters medora-intro__letters--right">
            <path d={MEDORA_GLYPHS.r} />
            <path d={MEDORA_GLYPHS.a} />
          </g>
        </g>
      </svg>
    </div>
  );
}
