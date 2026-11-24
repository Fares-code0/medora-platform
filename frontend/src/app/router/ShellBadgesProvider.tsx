import { useMemo, type ReactNode } from 'react';

import { useAuth, useToast } from '@/app/providers';
import { usePendingVerificationsCount } from '@/features/admin/doctors/api/pending-badge';
import { useMessagingBadgeQuery } from '@/features/doctor/messaging';
import {
  NOTIFICATION_CATEGORY_META,
  notificationCapabilities,
  useArchiveAllReadMutation,
  useMarkAllNotificationsReadMutation,
  useNotificationBadgesQuery,
  useRecentNotificationsQuery,
  useUpdateNotificationsMutation,
} from '@/features/doctor/notifications';
import { ShellBadgesContext, type ShellBadgesValue, type ShellFeedItem } from '@/layouts';
import { workspaceFor } from '@/routes/workspaces';
import { relativeDayLabel } from '@/utils/dates';

/**
 * App-layer bridge for the shell badge seam (§4): composes the
 * notifications feature's public queries into the domain-free
 * `ShellBadgesContext` that layouts consume — the app layer may import
 * features; layouts may not (§1.2). Wraps the doctor AppShell route and
 * (Phase 19) the admin Administration Center, so both roles share one
 * bell with real mark-read / clear behavior instead of a placeholder.
 */

/**
 * How many rows the bell shows — and how many it asks for: the feed is one
 * `GET /notifications?status=active&page=1&pageSize=FEED_SIZE`, never the
 * Notifications page's full drain, because this provider is mounted on every
 * page of every workspace that has a bell.
 */
const FEED_SIZE = 6;

export function ShellBadgesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const badges = useNotificationBadgesQuery();
  const messaging = useMessagingBadgeQuery();
  // Doctor verifications waiting on an administrator (FE-10.10). Asked for
  // only in the admin shell — a doctor may not read the roster — and shown
  // as nothing while loading or after a failure, never as a stand-in count.
  const pending = usePendingVerificationsCount(user?.role === 'admin');
  const recent = useRecentNotificationsQuery(FEED_SIZE);
  const update = useUpdateNotificationsMutation();
  const markAll = useMarkAllNotificationsReadMutation();
  const archiveRead = useArchiveAllReadMutation();

  const updateMutate = update.mutate;
  const markAllMutate = markAll.mutate;
  const archiveMutate = archiveRead.mutate;

  // The full Notifications page is a doctor workspace surface; every other
  // workspace manages everything inside the bell drawer itself.
  const viewAllHref = user === null ? null : workspaceFor(user.role).notifications;

  const value = useMemo<ShellBadgesValue>(() => {
    const notifications = (recent.data ?? []).filter((notification) => !notification.archived);

    const feed: readonly ShellFeedItem[] | null = recent.isPending
      ? null
      : notifications.slice(0, FEED_SIZE).map((notification) => {
          const meta = NOTIFICATION_CATEGORY_META[notification.category];
          return {
            id: notification.id,
            title: notification.title,
            detail: notification.body,
            timeLabel: relativeDayLabel(notification.createdAt),
            unread: !notification.read,
            icon: meta.icon,
            iconClass: meta.iconClass,
          };
        });

    // The badge as well as the list: the write is server-wide, so it is not
    // held back while the list is still loading.
    const hasUnread = notifications.some((n) => !n.read) || (badges.data?.notifications ?? 0) > 0;

    return {
      counts: {
        notifications: badges.data?.notifications ?? 0,
        // Phase 14: the messages badge now comes from the messaging
        // workspace, not the notifications feature's mini chat.
        messages: messaging.data?.unread ?? 0,
        pendingRequests: user?.role === 'admin' ? (pending.data ?? 0) : 0,
      },
      feed,
      markRead: (id: string) => updateMutate({ ids: [id], patch: { read: true } }),
      // One server write for everything unread — not a fan-out over the ids
      // this list happens to hold, which would miss anything delivered since
      // the last poll.
      markAllRead: () => {
        if (hasUnread) markAllMutate();
      },
      // A refused clear-read leaves the read rows where they are; say so,
      // since the bell closes on the click and nothing else would.
      clearRead: notificationCapabilities.clearRead
        ? () =>
            archiveMutate(undefined, {
              onError: () =>
                toast({
                  variant: 'error',
                  title: 'Could not archive read notifications',
                  description: 'Nothing was moved.',
                }),
            })
        : null,
      viewAllHref,
    };
  }, [
    badges.data,
    recent.data,
    recent.isPending,
    messaging.data,
    pending.data,
    user?.role,
    updateMutate,
    markAllMutate,
    archiveMutate,
    toast,
    viewAllHref,
  ]);

  return <ShellBadgesContext.Provider value={value}>{children}</ShellBadgesContext.Provider>;
}
