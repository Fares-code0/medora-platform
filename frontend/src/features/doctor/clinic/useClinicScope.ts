import { useMemo } from 'react';

import { useAuth } from '@/app/providers';
import { UNSCOPED, type ClinicScope } from '@/features/shared-domain/clinic-scope';

/**
 * The signed-in account's clinic scope (D-27b), or `null` for a doctor
 * whose session names no clinic.
 *
 * Reads the clinic off the session rather than a route param or a stored
 * preference: a scope the URL can set is a scope the URL can widen, and this
 * one must only ever narrow what the client displays.
 *
 * **Fails closed (AF-17, WEB-5).** A doctor without a `clinicId` used to get
 * `clinicId: null` — which `visibleToScope` reads as an administrator's
 * "every clinic" — so a live session, which never carries the mock's
 * `clinicId`, would have been shown every clinic's board. `null` here means
 * "nothing is this account's to see", and the caller renders an empty state
 * instead of fetching.
 *
 * It is a display rule, not access control, and it is not the hospital
 * boundary: the multi-hospital model replaces it with the server's active
 * hospital (CLIENTS_CHECKLIST WEB-1, WEB-5). See the boundary note in
 * `shared-domain/clinic-scope`.
 */
export function useClinicScope(): ClinicScope | null {
  const { user } = useAuth();

  return useMemo<ClinicScope | null>(() => {
    // Signed out is "nothing", never "everything".
    if (user === null) return null;
    // An admin has no clinic and spans them all; a doctor is pinned to theirs.
    if (user.role !== 'doctor') return UNSCOPED;
    if (user.clinicId === undefined || user.clinicId === '') return null;
    return {
      clinicId: user.clinicId,
      doctorId: user.id,
    };
  }, [user]);
}
