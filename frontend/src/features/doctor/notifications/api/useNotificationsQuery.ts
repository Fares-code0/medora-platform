import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import type { NotificationPatch, SendMessageInput } from '../model/notification-service';
import type { DoctorNotification } from '../model/types';

/**
 * Phase 19 (code splitting): the service — and the seeded dataset behind it —
 * is loaded on demand inside each queryFn/mutationFn instead of statically.
 * The shell imports this file for the badge queries, so a static import would
 * pull all mock data into the ENTRY chunk. It is the seam (`../service`) that
 * is loaded, never the adapter behind it (`docs/handoff/auth-seam.md` §1,
 * rule 3).
 */
const service = () => import('../service').then((module) => module.notificationService);

/**
 * Notifications data layer — TanStack Query over the notifications seam. The
 * badge query polls (the mock stand-in for a realtime channel) and is
 * ALSO exported through the feature's public API for the shell
 * (`badgeSource` wiring, FRONTEND_ARCHITECTURE §4): sidebar, bottom tab
 * bar, and the navbar bell all share this cache entry, so any mutation
 * updates the unread badge everywhere at once.
 */

export const notificationKeys = createKeyFactory('doctor-notifications');

const BADGE_KEY = [...notificationKeys.all, 'badges'] as const;
const CONVERSATIONS_KEY = [...notificationKeys.all, 'conversations'] as const;
/**
 * The shell bell's small feed — its own key, outside `lists()`, so the bell
 * never mounts (or refetches) the page's full multi-page drain.
 */
const RECENT_PREFIX = [...notificationKeys.all, 'recent'] as const;

export const recentNotificationsKey = (limit: number) => [...RECENT_PREFIX, limit] as const;

/**
 * What a write to the notifications themselves can change: the badge, the
 * page's list and the bell's feed. Never the conversations — a read flag on
 * a notification does not touch a chat.
 */
const NOTIFICATION_DATA_KEYS = [BADGE_KEY, notificationKeys.lists(), RECENT_PREFIX] as const;

/** Mock stand-in for realtime push: poll every 30 s + on window focus. */
const BADGE_POLL_MS = 30_000;

export function useNotificationsListQuery() {
  return useQuery({
    queryKey: notificationKeys.lists(),
    queryFn: () => service().then((notifications) => notifications.fetchNotifications()),
    staleTime: 15_000,
  });
}

/**
 * PUBLIC (feature index): the bell's feed — one `GET` of `limit` rows, not
 * the full list. Shares the badge's polling cadence so the feed and the
 * count it sits under do not drift apart.
 */
export function useRecentNotificationsQuery(limit: number) {
  return useQuery({
    queryKey: recentNotificationsKey(limit),
    queryFn: () => service().then((notifications) => notifications.fetchRecent(limit)),
    refetchInterval: BADGE_POLL_MS,
    staleTime: 10_000,
  });
}

/** PUBLIC (feature index): unread counts for the shell badges. */
export function useNotificationBadgesQuery() {
  return useQuery({
    queryKey: BADGE_KEY,
    queryFn: () => service().then((notifications) => notifications.fetchBadgeCounts()),
    refetchInterval: BADGE_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

/**
 * Reconciles exactly the caches a notification write can change. Only the
 * ones with a mounted observer refetch (TanStack's `refetchType: 'active'`),
 * so on any page but Notifications a row marked read from the bell costs a
 * badge read and a one-page feed read — not a re-drain of every page.
 */
function useInvalidateNotificationData() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of NOTIFICATION_DATA_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

/** A conversation write changes the threads and the messages badge only. */
function useInvalidateConversationData() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    void queryClient.invalidateQueries({ queryKey: BADGE_KEY });
  };
}

/**
 * Read / archive / favourite / pin — **optimistic, with rollback** (DP-05).
 *
 * This is the case optimism is for, and the case the clinical writes are
 * not. Marking a notification read asserts nothing about a patient: the
 * worst a failed write can do is put a row back, whereas a 400 ms wait on
 * every tick of a list a doctor is clearing makes the app feel broken. The
 * prescription signature, the lab review and the record signature all
 * decline optimism for the opposite reason, each recorded where it is
 * declined — a row that leaves the Inbox before the write lands has told
 * the doctor, wrongly, that it is handled.
 *
 * The badge cache is patched alongside the list, because the sidebar, the
 * bottom tab bar and the navbar bell all read it: updating only the list
 * would leave the unread count contradicting the rows beneath it for as
 * long as the write took.
 */
export function useUpdateNotificationsMutation() {
  const optimistic = useOptimisticListPatch();

  return useMutation({
    mutationFn: (input: { readonly ids: readonly string[]; readonly patch: NotificationPatch }) =>
      service().then((notifications) => notifications.updateNotifications(input.ids, input.patch)),

    onMutate: (input) => {
      const ids = new Set(input.ids);
      return optimistic.apply((notification) =>
        ids.has(notification.id) ? { ...notification, ...input.patch } : notification,
      );
    },
    onError: (_error, _input, context) => optimistic.rollback(context),
    onSettled: optimistic.reconcile,
  });
}

/**
 * "Mark all as read" — one server write (`markAllRead`), optimistic like the
 * per-row toggle and for the same reason. The patch mirrors the server's own
 * rule — unread **and unarchived** — so the archive keeps its read state
 * until the reconcile confirms it, rather than the client guessing wider than
 * the write.
 */
export function useMarkAllNotificationsReadMutation() {
  const optimistic = useOptimisticListPatch();

  return useMutation({
    mutationFn: () => service().then((notifications) => notifications.markAllRead()),

    onMutate: () =>
      optimistic.apply((notification) =>
        !notification.read && !notification.archived
          ? { ...notification, read: true }
          : notification,
      ),
    onError: (_error, _input, context) => optimistic.rollback(context),
    onSettled: optimistic.reconcile,
  });
}

interface ListPatchContext {
  readonly previousList: readonly DoctorNotification[] | undefined;
  readonly previousRecent: ReadonlyArray<
    readonly [QueryKey, readonly DoctorNotification[] | undefined]
  >;
  readonly previousBadges: unknown;
}

/** The optimistic patch-and-rollback both read-state mutations share (DP-05). */
function useOptimisticListPatch() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateNotificationData();

  return {
    async apply(
      patchRow: (notification: DoctorNotification) => DoctorNotification,
    ): Promise<ListPatchContext> {
      // Any in-flight refetch would otherwise land after this patch and
      // overwrite it with the pre-mutation server state.
      await Promise.all(
        NOTIFICATION_DATA_KEYS.map((queryKey) => queryClient.cancelQueries({ queryKey })),
      );

      const previousList = queryClient.getQueryData<readonly DoctorNotification[]>(
        notificationKeys.lists(),
      );
      const previousRecent = queryClient.getQueriesData<readonly DoctorNotification[]>({
        queryKey: RECENT_PREFIX,
      });
      const previousBadges = queryClient.getQueryData(BADGE_KEY);

      if (previousList !== undefined) {
        queryClient.setQueryData<readonly DoctorNotification[]>(
          notificationKeys.lists(),
          previousList.map(patchRow),
        );
      }
      // The bell's rows too, so a row read on the page stops reading as
      // unread in the bell before the write lands. An archived row leaves
      // the feed, which lists unarchived notifications only.
      for (const [queryKey, rows] of previousRecent) {
        if (rows === undefined) continue;
        queryClient.setQueryData<readonly DoctorNotification[]>(
          queryKey,
          rows.map(patchRow).filter((notification) => !notification.archived),
        );
      }

      // Returned as the rollback context; `rollback` restores exactly what
      // was there rather than refetching, so a failure is invisible.
      return { previousList, previousRecent, previousBadges };
    },

    rollback(context: ListPatchContext | undefined) {
      if (context?.previousList !== undefined) {
        queryClient.setQueryData(notificationKeys.lists(), context.previousList);
      }
      for (const [queryKey, rows] of context?.previousRecent ?? []) {
        queryClient.setQueryData(queryKey, rows);
      }
      if (context?.previousBadges !== undefined) {
        queryClient.setQueryData(BADGE_KEY, context.previousBadges);
      }
    },

    // Reconciles with the service either way: the optimistic patch is a
    // guess about the badge counts, never the source of them.
    reconcile: invalidate,
  };
}

export function useDeleteNotificationsMutation() {
  const invalidate = useInvalidateNotificationData();
  return useMutation({
    mutationFn: (ids: readonly string[]) =>
      service().then((notifications) => notifications.deleteNotifications(ids)),
    onSettled: invalidate,
  });
}

export function useArchiveAllReadMutation() {
  const invalidate = useInvalidateNotificationData();
  return useMutation({
    mutationFn: () => service().then((notifications) => notifications.archiveAllRead()),
    onSettled: invalidate,
  });
}

/* ── Communication center ───────────────────────────────────────── */

export function useConversationsQuery() {
  return useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: () => service().then((notifications) => notifications.fetchConversations()),
    staleTime: 15_000,
  });
}

export function useMarkConversationReadMutation() {
  const invalidate = useInvalidateConversationData();
  return useMutation({
    mutationFn: (conversationId: string) =>
      service().then((notifications) => notifications.markConversationRead(conversationId)),
    onSettled: invalidate,
  });
}

export function useSendMessageMutation() {
  const invalidate = useInvalidateConversationData();
  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      service().then((notifications) => notifications.sendMessage(input)),
    onSettled: invalidate,
  });
}
