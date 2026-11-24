import { useQuery } from '@tanstack/react-query';

import { fetchActiveHospital, type ActiveHospital } from '@/api/endpoints/session';
import { selectService } from '@/api/seam';
import { useAuth } from '@/app/providers';

/**
 * The signed-in doctor's active hospital, for display only — WEB-1 (DR-02).
 *
 * Keyed by the user's id, so one account never reads another's cached
 * answer even before `AuthProvider` clears the cache on sign-in/out. Asked
 * only of a live API, only for an authenticated doctor: the mock backend has
 * no employments, so mock mode answers no hospital rather than inventing one.
 *
 * A failure renders nothing and leaves the session alone; only the
 * `ApiClient`'s own 401 handling applies, as for every request.
 */

export const activeHospitalKeys = {
  all: ['session', 'active-hospital'] as const,
  forUser: (userId: string) => ['session', 'active-hospital', userId] as const,
};

interface ActiveHospitalSource {
  readonly live: boolean;
  readonly fetch: (signal: AbortSignal) => Promise<ActiveHospital | null>;
}

const ACTIVE_HOSPITAL_STALE_MS = 5 * 60_000;

export function useActiveHospital(): ActiveHospital | null {
  const { status, user } = useAuth();
  const source = selectService<ActiveHospitalSource>({
    mock: { live: false, fetch: () => Promise.resolve(null) },
    http: { live: true, fetch: fetchActiveHospital },
  });
  const userId = user?.id ?? '';
  const enabled =
    source.live && status === 'authenticated' && user?.role === 'doctor' && userId !== '';

  const query = useQuery({
    queryKey: activeHospitalKeys.forUser(userId),
    queryFn: ({ signal }) => source.fetch(signal),
    enabled,
    staleTime: ACTIVE_HOSPITAL_STALE_MS,
  });

  return enabled && query.isSuccess ? query.data : null;
}
