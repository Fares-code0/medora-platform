import { forwardRef } from 'react';

import type { LucideIcon, LucideProps } from 'lucide-react';

import { cn } from '@/utils/cn';

import medoraAiLogoUrl from './assets/medora-ai-logo.png';

/**
 * Medora AI — the assistant's visual identity: a red medical heart crossed by
 * a white ECG trace, wired to circuit traces with grey endpoints.
 *
 * The artwork is the supplied raster, not a redrawing. Its white page was
 * removed by flood-filling from the edges only (so the white ECG line inside
 * the heart is untouched), anti-aliased edge pixels were un-blended from white
 * to clean alpha, and the result was cropped square around the artwork and
 * resampled to 256×256 — sharp up to 85px at 3× density, far above any size
 * it is shown at. It keeps its own colours in both themes: red, orange and
 * grey all hold against the light and the dark surfaces.
 *
 * Shaped like a lucide icon (`LucideIcon`: forwardRef to an `<svg>`, same
 * props) so it drops into every `icon` / `leadingIcon` slot the generic
 * sparkles used to fill, sized by the slot's own `className`. `strokeWidth`
 * and `color` are accepted and ignored — a full-colour mark has neither.
 *
 * Decorative by default (`aria-hidden`), like the icons it replaces: the
 * control beside it carries the name. Pass `aria-label` to expose it as an
 * image on its own.
 */
export const MedoraAiLogo: LucideIcon = forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  function MedoraAiLogo(
    {
      className,
      size = 24,
      // A full-colour raster has no stroke and no fill colour to take.
      strokeWidth: _strokeWidth,
      absoluteStrokeWidth: _absoluteStrokeWidth,
      color: _color,
      children: _children,
      ...rest
    },
    ref,
  ) {
    const labelled = rest['aria-label'] !== undefined;
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={size}
        height={size}
        role={labelled ? 'img' : undefined}
        aria-hidden={labelled ? undefined : true}
        focusable="false"
        data-brand="medora-ai"
        className={cn('shrink-0', className)}
        {...rest}
      >
        <image
          href={medoraAiLogoUrl}
          width="256"
          height="256"
          preserveAspectRatio="xMidYMid meet"
        />
      </svg>
    );
  },
);
MedoraAiLogo.displayName = 'MedoraAiLogo';
