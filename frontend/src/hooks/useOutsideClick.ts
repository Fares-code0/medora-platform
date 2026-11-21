import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Invoke a handler when a pointer event starts outside every given ref.
 * Used by dismissible floating surfaces (dropdowns, selects, popovers).
 */
export function useOutsideClick(
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
  onOutside: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onOutside();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [refs, onOutside, enabled]);
}
