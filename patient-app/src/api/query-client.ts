import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/types/api';

import { PHI_QUERY_DOMAINS } from './query-keys';
import { EndpointNotImplementedError } from './seam';

/**
 * The query client, and the app's entire retry policy.
 *
 * ── Why the retry policy lives here and not in `ApiClient` ────────────
 * Only this layer knows whether a call is a safe read or a booking. A
 * transport that retries everything issues a second appointment when the
 * first response is lost on a train.
 *
 * ── What is deliberately never retried ───────────────────────────────
 * - `validation`, `forbidden`, `not_found`, `conflict` — the answer will
 *   not change, and a retried 409 is a race the patient loses twice.
 * - `auth` — `ApiClient` has already refreshed once; a retry here would
 *   send a second refresh with a rotated token and revoke the session
 *   family (backend ADR-026).
 * - `rate_limited` — hammering a rate limiter is how a client earns a
 *   longer ban. `Retry-After` is surfaced to the patient as a countdown
 *   (`ErrorState`) instead.
 * - `cancelled` — the patient navigated away.
 * - `EndpointNotImplementedError` — the endpoint will not appear between
 *   two attempts.
 *
 * ── Offline, and why `networkMode` is pinned ─────────────────────────
 * `NetworkProvider` tells `onlineManager` what NetInfo reports, so
 * `refetchOnReconnect` below is real rather than decorative — a browser's
 * `online` event does not exist in React Native, and without that wiring
 * the cache believed it was online forever (see the provider's docblock).
 *
 * That makes `networkMode` load-bearing, so it is stated rather than
 * defaulted. The default, `'online'`, PAUSES work while offline: a first
 * read would sit in `isPending` with no data behind it, which every
 * `AsyncBoundary` renders as an endless skeleton instead of the offline
 * error state R-04 specifies — and a mutation would be *held and
 * replayed on reconnect*, which is precisely the queue audit §12.4
 * forbids. `'always'` keeps both halves: reads fail and say why, writes
 * fail and say why, and the only thing connectivity changes is that what
 * is on screen re-asks when the signal comes back.
 *
 * ── PHI and the cache ────────────────────────────────────────────────
 * There is NO query persistence and there will not be one. The cache is
 * memory, it dies with the process, and `clearPhiCache` empties it early
 * on logout, session loss and background timeout (audit R-8).
 */

const MAX_RETRIES = 2;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (error instanceof EndpointNotImplementedError) return false;
  if (!isApiError(error)) return false;

  switch (error.kind) {
    case 'network':
    case 'timeout':
    case 'server':
      return true;
    case 'validation':
    case 'auth':
    case 'forbidden':
    case 'not_found':
    case 'conflict':
    case 'rate_limited':
    case 'cancelled':
      return false;
  }
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // See "Offline" above: never paused, so an offline read reaches
        // its error state instead of an endless skeleton.
        networkMode: 'always',
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // A patient reopening the app expects today's appointment to be
        // current, not the copy from this morning.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      // Mutations are NEVER retried automatically, and never paused. A
      // booking replayed against a slot that no longer exists is worse
      // than a clear failure the patient can act on (audit §12.4) —
      // `networkMode: 'always'` is what keeps `onlineManager` from
      // turning an offline write into exactly that replay.
      mutations: { networkMode: 'always', retry: false },
    },
  });
}

/**
 * Removes every cached byte of PHI.
 *
 * Called on logout, on a failed refresh, and on the background timeout.
 * It removes the listed domains explicitly *and then* clears the whole
 * cache — the explicit pass is what makes the guarantee testable per
 * domain, the clear is what covers a domain someone forgot to list.
 */
export function clearPhiCache(client: QueryClient): void {
  for (const domain of PHI_QUERY_DOMAINS) {
    client.removeQueries({ queryKey: [domain] });
  }
  client.clear();
}
