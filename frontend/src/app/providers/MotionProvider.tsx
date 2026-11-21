import type { ReactNode } from 'react';

import { LazyMotion, MotionConfig } from 'framer-motion';

import { useInterfaceSettings } from './InterfaceSettingsProvider';

/**
 * Global motion policy — DESIGN_SYSTEM.md §9.5.
 * `reducedMotion="user"` enforces prefers-reduced-motion for every Framer
 * Motion animation app-wide. When the doctor turns on "Reduce motion" in
 * Accessibility settings we escalate to `"always"`, so the app-level toggle
 * overrides even users whose OS setting is off.
 *
 * Phase 19: LazyMotion + `m` components load the animation feature bundle
 * (domMax) asynchronously, cutting framer-motion out of the entry chunk.
 * `strict` guarantees no full `motion.*` component sneaks back in.
 */

const loadFeatures = () => import('./motion-features').then((module) => module.default);

export function MotionProvider({ children }: { children: ReactNode }) {
  const { settings } = useInterfaceSettings();
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
