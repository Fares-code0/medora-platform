import { useEffect } from 'react';

import { useBlocker, type Blocker } from 'react-router-dom';

/**
 * Unsaved-changes protection (UX §2.11 "dirty-state save, unsaved guard").
 *
 * Two escape routes have to be covered and they are covered differently:
 * in-app navigation is intercepted by the data router's `useBlocker`, which
 * hands back a blocker the caller renders a dialog for; leaving the tab is
 * intercepted by `beforeunload`, where the browser owns the dialog and the
 * only contract is a cancelled event.
 *
 * Returns the blocker so the caller can render its own confirmation — the
 * hook deliberately does not render UI.
 */
export function useUnsavedChangesGuard(dirty: boolean): Blocker {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers key off returnValue rather than preventDefault.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return blocker;
}
