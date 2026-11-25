import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * "Is the session that sent this request still the current one?" — asked
 * by a mutation callback that runs after the response lands.
 *
 * ── Why a mutation callback has to ask ───────────────────────────────
 * Signing out clears the query cache (`clearPhiCache` → `client.clear()`),
 * but it cannot stop a request already on the wire, and TanStack still runs
 * that mutation's `onSuccess` / `onError` afterwards. A callback that wrote
 * by key would re-create the previous account's data — or overwrite the
 * next account's query that has since taken the same key — and a toast it
 * raised would land on the sign-in screen or in the next account's session,
 * because the toast provider outlives the session.
 *
 * ── How it answers ───────────────────────────────────────────────────
 * `captureLive` is called from `onMutate` and records the Query INSTANCES
 * under the key, not only the key. A query is live while the cache still
 * holds that very instance under its hash: `clear()` drops it, and a query
 * the next account builds under the same key is a different instance.
 *
 * When nothing was cached under the key there is no instance to watch, and
 * "nothing to watch" must not read as "signed out". The fallback is the
 * mutation cache, which the same `clear()` empties: `onMutate` runs after
 * TanStack has put the calling mutation in that cache as `pending`, and a
 * pending mutation is never garbage-collected, so it leaves only through a
 * clear. Any pending mutation seen at capture time still being there means
 * no clear has happened since.
 */
export interface LiveCapture {
  /** The captured queries that are still the live instance under their key. */
  readonly liveQueries: () => readonly Query[];
  /** Whether the session the capture was taken in is still the current one. */
  readonly isCurrent: () => boolean;
}

/** Call from `onMutate`, so the calling mutation is already in the cache. */
export function captureLive(queryClient: QueryClient, queryKey: QueryKey): LiveCapture {
  const queryCache = queryClient.getQueryCache();
  const mutationCache = queryClient.getMutationCache();
  const queries = queryCache.findAll({ queryKey });
  const inFlight = mutationCache.getAll().filter((mutation) => mutation.state.status === 'pending');

  const liveQueries = () => queries.filter((query) => queryCache.get(query.queryHash) === query);

  return {
    liveQueries,
    isCurrent: () => {
      if (queries.length > 0) return liveQueries().length > 0;
      const now = mutationCache.getAll();
      return inFlight.some((mutation) => now.includes(mutation));
    },
  };
}
