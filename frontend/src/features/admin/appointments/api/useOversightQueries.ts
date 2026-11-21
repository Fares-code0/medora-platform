/**
 * Appointment oversight — TanStack Query hooks (ADM-05, FE-10.10).
 *
 * One query holds the book and the roster together, because a reassignment
 * moves both: it changes an appointment *and* consumes the receiving
 * doctor's slot. Splitting them would let the picker offer capacity that
 * has already been spent. The KPI strip is a second query — the live API
 * computes it server-side (API §5.11) rather than from the page in hand.
 *
 * A write resolves to the patched demo document, seeded straight into the
 * cache, or to `null` from the live adapter, which re-reads the book. The
 * KPI strip is re-read after every write, and after a refused one too: a
 * partly-sent batch of nudges has still changed the book.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { CancelInput, NudgeInput, OversightDocument, ReassignInput } from './oversight.api';
import { oversightService } from './service';

const STALE_MS = 30_000;

export const oversightKeys = {
  all: ['admin', 'appointment-oversight'] as const,
  document: () => [...oversightKeys.all, 'document'] as const,
  summary: () => [...oversightKeys.all, 'summary'] as const,
} as const;

/** What this build's oversight service can show. */
export const oversightCapabilities = oversightService.capabilities;

export function useOversightDocument() {
  return useQuery({
    queryKey: oversightKeys.document(),
    queryFn: () => oversightService.list(),
    staleTime: STALE_MS,
  });
}

export function useOversightSummary() {
  return useQuery({
    queryKey: oversightKeys.summary(),
    queryFn: () => oversightService.summary(),
    staleTime: STALE_MS,
  });
}

function settle(queryClient: QueryClient, result: OversightDocument | null): void {
  if (result === null) {
    void queryClient.invalidateQueries({ queryKey: oversightKeys.all });
    return;
  }
  queryClient.setQueryData(oversightKeys.document(), result);
  void queryClient.invalidateQueries({ queryKey: oversightKeys.summary() });
}

export function useOversightMutations() {
  const queryClient = useQueryClient();
  const onSuccess = (result: OversightDocument | null) => settle(queryClient, result);
  const onError = () => {
    void queryClient.invalidateQueries({ queryKey: oversightKeys.all });
  };

  const nudge = useMutation({
    mutationFn: (input: NudgeInput) => oversightService.nudge(input),
    onSuccess,
    onError,
  });

  const reassign = useMutation({
    mutationFn: (input: ReassignInput) => oversightService.reassign(input),
    onSuccess,
    onError,
  });

  const cancel = useMutation({
    mutationFn: (input: CancelInput) => oversightService.cancelAdministratively(input),
    onSuccess,
    onError,
  });

  return { nudge, reassign, cancel };
}
