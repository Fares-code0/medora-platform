import { useEffect, useState } from 'react';

import { AccessibilityInfo } from 'react-native';

/**
 * The OS reduce-motion switch.
 *
 * Motion sensitivity is a vestibular condition, not a preference, and a
 * healthcare app is more likely than most to be used by someone who has
 * one. Every animated surface reads this and collapses its duration to
 * zero rather than merely shortening it (checklist S-06, C-10).
 *
 * ── Why the return type has three states ─────────────────────────────
 * `AccessibilityInfo.isReduceMotionEnabled()` is a promise, so the answer
 * is not available on the first render. Defaulting to `false` for that
 * frame starts an animation and then stops it — which is a flash of
 * motion shown to precisely the person who asked not to see any.
 * `null` means "not known yet", and a caller treats it as "do not
 * animate" until it resolves.
 */
export function useReducedMotionSetting(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/** True when motion should be suppressed — including while unknown. */
export function useReducedMotion(): boolean {
  return useReducedMotionSetting() !== false;
}

/** A duration that honours the switch. `0` disables the animation outright. */
export function useMotionDuration(ms: number): number {
  return useReducedMotion() ? 0 : ms;
}
