import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import type { AiMode } from './model/types';
import { aiService } from './service';

/**
 * The assistant's query surface.
 *
 * `ai-conversations` is a PHI domain (`PHI_QUERY_DOMAINS`): what a patient
 * asks an assistant about their own body or their own appointments is
 * health information, so `clearPhiCache` sweeps it on logout, session
 * loss and a background timeout. It is also never written to disk by this
 * client — the transcript lives on the server (K-07) and in this cache.
 */
export const aiKeys = createKeyFactory('ai-conversations');

/** The caller's conversations in ONE mode — the two lists are never merged. */
export function useAiConversations(mode: AiMode) {
  return useQuery({
    queryKey: aiKeys.list({ mode }),
    queryFn: async () => (await aiService.listConversations()).filter((c) => c.mode === mode),
  });
}

export function useAiConversation(id: string | undefined) {
  return useQuery({
    queryKey: aiKeys.detail(id ?? ''),
    queryFn: () => aiService.getConversation(id ?? ''),
    enabled: id !== undefined,
  });
}

export function useDeleteAiConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => aiService.deleteConversation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiKeys.lists() }),
  });
}
