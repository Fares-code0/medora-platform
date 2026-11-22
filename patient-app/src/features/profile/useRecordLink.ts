import { useQuery } from '@tanstack/react-query';

import type { EmptyStateProps } from '@/components';
import { useT } from '@/i18n';

import { profileKeys } from './keys';
import { profileService } from './service';

/**
 * Whether this account is linked to a clinical record (checklist F-09).
 *
 * A patient registration creates an account and **no `patients` row**
 * (backend `registration.service.ts`, ADR-030 §4), and `/me/appointments`
 * answers such an account with an empty list rather than an error
 * (`patient-appointment.controller.ts`). So a new patient's Home and
 * Appointments said *Nothing booked* — true, and misleading: nothing can
 * appear until a record is linked, and only Profile said so.
 *
 * Read from `GET /me/profile` (`patient: null` → `linkedToClinicalRecord:
 * false`), through the same query key Profile uses, so it is one request
 * and one cache entry, swept with the rest of `profile` on sign-out.
 *
 * - `false` — the server said the account is not linked.
 * - `true` — it is.
 * - `null` — not known (loading, or the profile could not be read). The
 *   caller keeps its ordinary empty state: an unknown is never reported
 *   as "not linked".
 *
 * There is deliberately **no call to action**. How a patient gets linked
 * — claiming a pre-existing record — is undecided (RA-030.1, OQ-02), and
 * a button that implies a flow would invent one.
 */
export function useRecordLink(): boolean | null {
  const profile = useQuery({ queryKey: profileKeys.all, queryFn: () => profileService.get() });
  return profile.data?.linkedToClinicalRecord ?? null;
}

/**
 * The empty state to show instead of an ordinary one when the account is
 * not linked, or `null` to keep the caller's own. Only the empty branch
 * changes: loading, errors and data render exactly as before.
 */
export function useUnlinkedEmptyState(): EmptyStateProps | null {
  const t = useT();
  const linked = useRecordLink();
  if (linked !== false) return null;
  return {
    icon: 'info',
    title: t('profile.unlinked.title'),
    body: t('profile.unlinked.body'),
  };
}
