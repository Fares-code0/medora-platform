import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import type { ConversationPatch, SendMessageInput } from '../model/messaging-service';

/**
 * Phase 19 (code splitting): the service is loaded on demand inside each
 * queryFn/mutationFn — the shell imports this file for the unread badge, so
 * a static import would pull mock conversations into the ENTRY chunk. It is
 * the seam (`../service`) that is loaded, never the adapter behind it
 * (`docs/handoff/auth-seam.md` §1, rule 3).
 */
const service = () => import('../service').then((module) => module.messagingService);

/**
 * Messaging data layer — TanStack Query over the messaging seam. The badge
 * query polls (the mock stand-in for a realtime channel) and is ALSO
 * exported through the feature's public API so the shell sidebar/tab-bar
 * unread badge shares this cache entry (`badgeSource: 'messages'`).
 */

export const messagingKeys = createKeyFactory('doctor-messaging');

const CONVERSATIONS_KEY = [...messagingKeys.all, 'conversations'] as const;
const CONTACTS_KEY = [...messagingKeys.all, 'contacts'] as const;
const BADGE_KEY = [...messagingKeys.all, 'badge'] as const;

const BADGE_POLL_MS = 30_000;

export function useConversationsQuery() {
  return useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: () => service().then((messaging) => messaging.fetchConversations()),
    staleTime: 10_000,
  });
}

export function useContactsQuery() {
  return useQuery({
    queryKey: CONTACTS_KEY,
    queryFn: () => service().then((messaging) => messaging.fetchContacts()),
    staleTime: Infinity,
  });
}

/** PUBLIC (feature index): unread count for the shell messages badge. */
export function useMessagingBadgeQuery() {
  return useQuery({
    queryKey: BADGE_KEY,
    queryFn: () => service().then((messaging) => messaging.fetchMessagingBadge()),
    refetchInterval: BADGE_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

function useInvalidateMessaging() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: messagingKeys.all });
  };
}

export function useUpdateConversationMutation() {
  const invalidate = useInvalidateMessaging();
  return useMutation({
    mutationFn: (input: { readonly id: string; readonly patch: ConversationPatch }) =>
      service().then((messaging) => messaging.updateConversation(input.id, input.patch)),
    onSettled: invalidate,
  });
}

export function useDeleteConversationMutation() {
  const invalidate = useInvalidateMessaging();
  return useMutation({
    mutationFn: (id: string) => service().then((messaging) => messaging.deleteConversation(id)),
    onSettled: invalidate,
  });
}

export function useSendMessageMutation() {
  const invalidate = useInvalidateMessaging();
  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      service().then((messaging) => messaging.sendMessage(input)),
    onSettled: invalidate,
  });
}

export function useDeliverReplyMutation() {
  const invalidate = useInvalidateMessaging();
  return useMutation({
    mutationFn: (conversationId: string) =>
      service().then((messaging) => messaging.deliverReply(conversationId)),
    onSettled: invalidate,
  });
}

export function useMarkConversationReadMutation() {
  const invalidate = useInvalidateMessaging();
  return useMutation({
    mutationFn: (id: string) => service().then((messaging) => messaging.markConversationRead(id)),
    onSettled: invalidate,
  });
}
