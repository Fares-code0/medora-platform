import { forwardRef } from 'react';

import { Sparkles, type LucideIcon, type LucideProps } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Medora AI — the assistant's visual identity: the lucide `Sparkles` glyph.
 *
 * A vector icon drawn with `currentColor`, so it follows the theme and the
 * colour of the control it sits in (no raster to download, no separate dark
 * variant). It used to wrap a 16 KB WebP of a heart/ECG artwork; that image
 * was retired in favour of this lighter, theme-aware mark.
 *
 * Shaped like a lucide icon (`LucideIcon`: forwardRef to an `<svg>`, same
 * props — `size`, `className`, `strokeWidth`, `color`) so it drops into every
 * `icon` / `leadingIcon` slot, sized by the slot's own `className`.
 *
 * Decorative by default (`aria-hidden`), like the icons it sits beside: the
 * control carries the name. Pass `aria-label` to expose it as an image on its
 * own.
 */
export const MedoraAiLogo: LucideIcon = forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  function MedoraAiLogo({ className, size = 24, ...rest }, ref) {
    const labelled = rest['aria-label'] !== undefined;
    return (
      <Sparkles
        ref={ref}
        size={size}
        role={labelled ? 'img' : undefined}
        aria-hidden={labelled ? undefined : true}
        focusable="false"
        data-brand="medora-ai"
        className={cn('shrink-0', className)}
        {...rest}
      />
    );
  },
);
MedoraAiLogo.displayName = 'MedoraAiLogo';
