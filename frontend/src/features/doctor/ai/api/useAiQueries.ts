import { useCallback } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import type { AiConversation, AiConversationContext } from '../model/types';
import { aiService } from '../service';

/**
 * AI assistant data layer — TanStack Query over the assistant seam
 * (`../service`, D-09), never over an adapter directly.
 * Conversations are one list query (they're small, local objects); every
 * mutation invalidates it. Swapping the mock service for the real
 * assistant API changes nothing above this file.
 */

export const aiKeys = createKeyFactory('doctor-ai');

export function useConversationsQuery() {
  return useQuery({
    queryKey: aiKeys.lists(),
    queryFn: () => aiService.listConversations(),
    staleTime: 5_000,
  });
}

/**
 * Create is synchronous (see the port's note): navigation to the new
 * conversation must never wait on — or be dropped by — an async mutation
 * callback. This hook wraps it with the cache invalidation.
 */
export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useCallback(
    (input: {
      readonly context: AiConversationContext;
      readonly title?: string;
      readonly seedGreeting?: boolean;
    }): AiConversation => {
      const conversation = aiService.createConversation(input);
      void queryClient.invalidateQueries({ queryKey: aiKeys.lists() });
      return conversation;
    },
    [queryClient],
  );
}

export function useUpdateConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      readonly conversationId: string;
      readonly patch: Partial<Pick<AiConversation, 'title' | 'favorite' | 'messages' | 'context'>>;
    }) => aiService.updateConversation(input.conversationId, input.patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: aiKeys.lists() }),
  });
}

export function useDeleteConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => aiService.deleteConversation(conversationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: aiKeys.lists() }),
  });
}
