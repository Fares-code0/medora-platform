/**
 * Communication monitoring — TanStack Query hooks (ADM-06).
 *
 * One query for the whole screen. All three tabs read the same cache entry,
 * so a flag resolved on the flags tab is already true in the Overview flag
 * rate — no refetch, and no chance of the two disagreeing.
 *
 * Mutations resolve to the full patched document and seed the cache with
 * `setQueryData`, the StrictMode-safe pattern used across the app.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  communicationsApi,
  type CloseAccessInput,
  type FlagStatusInput,
  type OpenAccessInput,
  type ResolveFlagInput,
} from './communications.api';
import type { CommunicationsDocument } from './communications.types';

const STALE_MS = 30_000;

export const communicationsKeys = {
  all: ['admin', 'communications'] as const,
  document: () => [...communicationsKeys.all, 'document'] as const,
} as const;

export function useCommunicationsDocument() {
  return useQuery({
    queryKey: communicationsKeys.document(),
    queryFn: communicationsApi.list,
    staleTime: STALE_MS,
  });
}

function useDocumentMutation<TInput>(
  mutationFn: (input: TInput) => Promise<CommunicationsDocument>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (document) => {
      client.setQueryData(communicationsKeys.document(), document);
    },
  });
}

export function useSetFlagStatusMutation() {
  return useDocumentMutation<FlagStatusInput>(communicationsApi.setFlagStatus);
}

export function useResolveFlagMutation() {
  return useDocumentMutation<ResolveFlagInput>(communicationsApi.resolveFlag);
}

/**
 * The exception to the pattern above: this resolves to the access-log ENTRY,
 * not the document, because its `id` is the reference the viewer banner
 * shows and the caller needs it in hand. The document is invalidated after,
 * since the access log it contains has changed.
 */
export function useOpenAccessMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenAccessInput) => communicationsApi.openAccess(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: communicationsKeys.document() });
    },
  });
}

export function useCloseAccessMutation() {
  return useDocumentMutation<CloseAccessInput>(communicationsApi.closeAccess);
}
