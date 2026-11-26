import { useEffect } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { useOptionalSession } from '@/features/auth/SessionProvider';
import { isApiError } from '@/types/api';

import { isIneligibleProbeRefusal } from './probe';
import { patientLinkService } from './service';

/**
 * `patient-link` is a PHI domain (`PHI_QUERY_DOMAINS`): the linked
 * record's name is in it, so it goes with every sign-out, session loss,
 * background sweep and account switch.
 */
export const patientLinkKeys = createKeyFactory('patient-link');

/**
 * The account's link state — and the app's eligibility probe (C-11).
 *
 * `403 patient_only` from THIS route, and only this route, ends the
 * session as `ineligible` (`eligibility.ts`). Any other failure is this
 * query's own error state; a 403 without that code is not a verdict on
 * the account.
 */
export function usePatientLink() {
  const session = useOptionalSession();
  const query = useQuery({
    queryKey: patientLinkKeys.all,
    queryFn: () => patientLinkService.getState(),
  });

  const endIneligibleSession = session?.endIneligibleSession;
  const ineligible = isIneligibleProbeRefusal(query.error);
  useEffect(() => {
    if (ineligible && endIneligibleSession !== undefined) void endIneligibleSession();
  }, [endIneligibleSession, ineligible]);

  return query;
}

/** `true` / `false` once known, `null` while unknown — never a guess. */
export function useIsLinked(): boolean | null {
  const { data } = usePatientLink();
  return data === undefined ? null : data.linked;
}

/** Whether a failure is the route's `409 already_linked`. */
export function isAlreadyLinked(error: unknown): boolean {
  return isApiError(error) && error.kind === 'conflict' && error.code === 'already_linked';
}

/**
 * `POST /me/patient-link/code`. Never retried (mutations never are): a
 * second code invalidates the first, so a silent retry could void the
 * code already on screen.
 *
 * `409 already_linked` means staff linked the account since the state was
 * read — the answer is to read it again, which turns the screen into the
 * linked state rather than an error.
 */
export function useIssueLinkCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => patientLinkService.issueCode(),
    onError: (error) => {
      if (isAlreadyLinked(error)) {
        void queryClient.invalidateQueries({ queryKey: patientLinkKeys.all });
      }
    },
  });
}
