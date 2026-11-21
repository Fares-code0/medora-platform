import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { ShellSearchContext, type ShellSearchValue } from '@/layouts';

/**
 * Fills the shell's search seam for the doctor area — and loads the index's
 * **code** only when the field is first engaged (NEW-21).
 *
 * D-26 already kept the index from *fetching* until then: five datasets
 * behind mock latency on every doctor page is five round trips spent on a
 * control most page views never touch. But this provider mounts on every
 * doctor page, and it imported the index statically, so the index's five
 * feature query hooks — each feature's service, both adapters and its demo
 * data — were downloaded on every doctor page anyway (≈7 kB gzip of route
 * code arriving with the shell).
 *
 * Until the field is engaged, the shell gets an empty index. From the moment
 * it is engaged the value reports `pending`, so the panel says "Searching…"
 * — never "No matches" about a patient whose index is still on its way —
 * and once the bridge has loaded, the real index's value takes over.
 */
const DoctorSearchIndexBridge = lazy(() => import('./DoctorSearchIndexBridge'));

const EMPTY: readonly never[] = [];

export function DoctorShellSearchProvider({ children }: { children: ReactNode }) {
  const [engaged, setEngaged] = useState(false);
  const [index, setIndex] = useState<ShellSearchValue | null>(null);
  const onActivate = useCallback(() => setEngaged(true), []);

  const placeholder = useMemo<ShellSearchValue>(
    () => ({ search: () => EMPTY, onActivate, pending: engaged }),
    [onActivate, engaged],
  );

  return (
    <ShellSearchContext.Provider value={index ?? placeholder}>
      {engaged ? (
        <Suspense fallback={null}>
          <DoctorSearchIndexBridge onValue={setIndex} />
        </Suspense>
      ) : null}
      {children}
    </ShellSearchContext.Provider>
  );
}
