import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

/**
 * Connectivity.
 *
 * ── The three states, and why there are three ────────────────────────
 * `isConnected` is "the radio has a link". `isInternetReachable` is "that
 * link goes somewhere" — a captive-portal wifi is connected and useless,
 * which on a hospital guest network is the common case, not the edge one.
 * NetInfo reports the second as `null` until it has probed, and treating
 * `null` as offline shows an offline banner for a second on every cold
 * start. So: online unless proven otherwise.
 *
 * ── What the app does with it ────────────────────────────────────────
 * Reads degrade: cached data where it is safe, a clear offline state
 * where it is not. Writes REFUSE — a booking queued offline and replayed
 * three hours later against a slot that no longer exists is worse than a
 * clear "you're offline" (audit §12.4). There is deliberately no mutation
 * queue in this tree.
 *
 * Emergency does not consult this at all. Its content is bundled, and a
 * screen that must work when everything else fails cannot depend on a
 * provider that might not have mounted.
 *
 * ── It also tells the cache, which used to hear nothing ──────────────
 *
 * `query-client.ts` has set `refetchOnReconnect: true` since it was
 * written, and it did nothing. TanStack Query learns about connectivity
 * from its own `onlineManager`, whose default listener is the browser's
 * `online`/`offline` events — which React Native does not have and never
 * fires. `onlineManager.isOnline()` was therefore `true` forever, there
 * was no reconnect for anything to refetch on, and a patient who lost
 * signal in a lift had to find and press Retry on every screen when it
 * came back.
 *
 * So the same NetInfo subscription that drives the banner drives the
 * cache: one probe, one definition of online (below), no second
 * listener that could disagree with the banner the patient is reading.
 *
 * **This does not add a queue.** `networkMode: 'always'` in
 * `query-client.ts` keeps both halves of audit §12.4 intact: a read run
 * offline fails and shows its offline error state instead of hanging in
 * a paused skeleton with no data behind it, and a write offline fails
 * immediately instead of being held and replayed against a slot that has
 * since gone. The only thing the cache does with `online` is refetch
 * what is on screen when it comes back.
 */

/**
 * One definition of "online", read by the banner and by the cache.
 *
 * `isInternetReachable` is `null` until NetInfo has probed, and `null`
 * is not "no" — treating it as offline shows the banner for a second on
 * every cold start.
 */
export function isOnlineFrom(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export interface NetworkStatus {
  readonly isOnline: boolean;
  /** True only while NetInfo has not yet reported. */
  readonly isUnknown: boolean;
}

const NetworkContext = createContext<NetworkStatus>({ isOnline: true, isUnknown: true });

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<NetworkStatus>({ isOnline: true, isUnknown: true });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isOnline = isOnlineFrom(state);
      setStatus({ isOnline, isUnknown: false });
      // The cache's own view of connectivity. `setOnline` is a no-op
      // when the value has not changed, so this is one call per real
      // transition, not one per NetInfo event.
      onlineManager.setOnline(isOnline);
    });
    return unsubscribe;
  }, []);

  const value = useMemo(() => status, [status]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetworkStatus(): NetworkStatus {
  return useContext(NetworkContext);
}
