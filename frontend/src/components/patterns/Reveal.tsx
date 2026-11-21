import type { ReactNode } from 'react';

import { m } from 'framer-motion';

import { EASE_OUT, motionTokens, staggerDelay } from '@/styles/motion';

/**
 * Reveal — one widget's entrance (UX §4.2): fade + 12px rise.
 * Promoted out of OverviewPage so the whole app shares one entrance.
 * Prefer <Stagger> over passing `index` by hand; it owns the arithmetic.
 *
 * `m.div`, never `motion.div` — MotionProvider's LazyMotion is `strict`.
 * Reduced motion is handled globally by MotionConfig, not here.
 */
export interface RevealProps {
  /** Position in the entrance sequence. Delays cap at motionTokens.staggerCap. */
  index?: number;
  className?: string | undefined;
  children: ReactNode;
}

export function Reveal({ index = 0, className, children }: RevealProps) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: motionTokens.duration.moderate,
        ease: EASE_OUT,
        delay: staggerDelay(index),
      }}
    >
      {children}
    </m.div>
  );
}
