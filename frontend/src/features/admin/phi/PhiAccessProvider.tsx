import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth, useCan, useToast } from '@/app/providers';

import type { PhiJustificationCategory } from '../administration.types';
import { useRecordPhiAccessMutation } from '../api/useAdministrationQueries';

import { JustificationDialog } from './JustificationDialog';
import {
  formatExpiry,
  grantFor,
  PHI_ELEVATION_MINUTES,
  pruneGrants,
  type PhiGrant,
} from './phi-access';
import { PhiAccessContext, type PhiAccessValue } from './phi-context';

/**
 * The PHI elevation gate (ADM-10 · UX §1.5.1, §1.5.6).
 *
 * Three things have to be true at once before a patient identifier is shown
 * in the admin area, and this provider is where they meet:
 *
 *  1. the signed-in role holds `patients.revealIdentity` (the ADM-09 matrix
 *     decides that — this only reads it);
 *  2. the administrator has given a categorised, written justification for
 *     *this* record;
 *  3. that justification was successfully written to the audit log.
 *
 * Point 3 is why the grant is applied in the mutation's success path and
 * nowhere else: if the log write fails, the value stays masked. An access
 * that failed to log is an access that did not happen.
 *
 * Grants live in memory only and expire after PHI_ELEVATION_MINUTES, at
 * which point the fields re-mask themselves without anyone doing anything.
 */

interface PendingRequest {
  readonly subjectId: string;
  readonly subjectLabel: string;
}

export function PhiAccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const can = useCan();
  const { toast } = useToast();
  const record = useRecordPhiAccessMutation();

  const [grants, setGrants] = useState<readonly PhiGrant[]>([]);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canReveal = can('patients.revealIdentity');

  // Elevation must lapse on its own. Ticking once a second is enough
  // precision for a 15-minute window and costs nothing while no grant is
  // live (the interval only runs when there is something to expire).
  const hasGrants = grants.length > 0;
  useEffect(() => {
    if (!hasGrants) return undefined;
    const id = window.setInterval(() => {
      setGrants((current) => pruneGrants(current, Date.now()));
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [hasGrants]);

  // Losing the capability (a matrix edit, a role change) must take live
  // elevations with it rather than leaving revealed fields on screen.
  const lastCanReveal = useRef(canReveal);
  useEffect(() => {
    if (lastCanReveal.current && !canReveal) setGrants([]);
    lastCanReveal.current = canReveal;
  }, [canReveal]);

  const isRevealed = useCallback(
    (subjectId: string) => grants.some((grant) => grant.subjectId === subjectId),
    [grants],
  );

  const grantOf = useCallback(
    (subjectId: string) => grants.find((grant) => grant.subjectId === subjectId),
    [grants],
  );

  const requestReveal = useCallback((subjectId: string, subjectLabel: string) => {
    setError(null);
    setPending({ subjectId, subjectLabel });
  }, []);

  const hide = useCallback((subjectId: string) => {
    setGrants((current) => current.filter((grant) => grant.subjectId !== subjectId));
  }, []);

  const confirm = (category: PhiJustificationCategory, reason: string) => {
    if (!pending) return;
    const request = pending;
    setError(null);
    record
      .mutateAsync({
        actor: user?.name ?? 'Administrator',
        subjectId: request.subjectId,
        subjectLabel: request.subjectLabel,
        category,
        reason: reason.trim(),
        durationMinutes: PHI_ELEVATION_MINUTES,
      })
      .then(
        () => {
          // Only now — the access is on the record.
          const grant = grantFor(
            request.subjectId,
            request.subjectLabel,
            category,
            reason,
            Date.now(),
          );
          setGrants((current) => [
            ...current.filter((g) => g.subjectId !== grant.subjectId),
            grant,
          ]);
          setPending(null);
          toast({
            variant: 'success',
            title: 'Identifiers revealed',
            description: `Logged against your account · re-masks at ${formatExpiry(grant)}.`,
          });
        },
        () => {
          setError('The access could not be logged, so nothing was revealed. Try again.');
        },
      );
  };

  const value = useMemo<PhiAccessValue>(
    () => ({
      canReveal,
      isRevealed,
      grantOf,
      requestReveal,
      hide,
      elevationMinutes: PHI_ELEVATION_MINUTES,
    }),
    [canReveal, isRevealed, grantOf, requestReveal, hide],
  );

  return (
    <PhiAccessContext.Provider value={value}>
      {children}
      <JustificationDialog
        open={pending !== null}
        subjectLabel={pending?.subjectLabel ?? ''}
        submitting={record.isPending}
        error={error}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onConfirm={confirm}
      />
    </PhiAccessContext.Provider>
  );
}
