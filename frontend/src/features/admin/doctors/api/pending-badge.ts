import { useQuery } from '@tanstack/react-query';

import { doctorsKeys } from './keys';

/**
 * The shell's "pending requests" badge: doctor verifications waiting on an
 * administrator (FE-10.10).
 *
 * In live mode the count is the server's — `GET /doctors?verification=pending`
 * — and in the demo build it is the seeded store's; never a constant. It
 * shares `doctorsKeys.pending()` with the doctors screens, whose decisions
 * invalidate or re-seed it, so the badge moves the moment a verification is
 * decided.
 *
 * The service is imported on demand: this hook runs in the shell around
 * every signed-in page, and the doctors service carries the demo store with
 * it. `enabled` is the caller's — only an administrator may read the roster.
 */
export function usePendingVerificationsCount(enabled: boolean) {
  return useQuery({
    queryKey: doctorsKeys.pending(),
    queryFn: async () => {
      const { doctorsService } = await import('./service');
      return doctorsService.pendingVerifications();
    },
    staleTime: 30_000,
    enabled,
  });
}
