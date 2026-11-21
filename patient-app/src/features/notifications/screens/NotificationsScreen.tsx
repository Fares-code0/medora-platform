import { useCallback } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { optimisticUpdate } from '@/api/optimistic';
import { usePagedQuery } from '@/api/paged';
import { Badge, Button, Card, PagedList, Text, useToast } from '@/components';
import { useT } from '@/i18n';
import type { RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { NotificationRow } from '../components/NotificationRow';
import { notificationTarget } from '../deep-link';
import { notificationKeys } from '../keys';
import type { NotificationPage, PatientNotification } from '../model/types';
import { notificationService } from '../service';

/**
 * The notification centre.
 *
 * Unread is carried by a dot, a tinted surface AND a "New" badge, not by
 * boldness alone — a font-weight difference is not a reliable signal at
 * large accessibility text sizes, where everything is already heavy.
 *
 * Tapping marks read AND, where the notification points somewhere, goes
 * there. Until 2026-09-09 it only marked read: the adapter had built a
 * `deepLink` for every appointment notification since O-01 landed and
 * nothing read it, so "Your appointment was confirmed" was a statement
 * with no way to act on it, and the tap that acknowledged it was the tap
 * that lost it. Where a notification points nowhere -- most of them --
 * the tap still only marks read, which is why marking read is not
 * conditional on there being a target.
 *
 * `deep-link.ts` decides where "there" is, from an allow-list, because
 * the link is server-supplied text. There is no swipe-to-dismiss: a
 * swipe is a gesture a phone performs in a pocket, and a security
 * notification dismissed by accident is one the patient never sees.
 *
 * Read state is the one thing on this screen the client already knows
 * the answer to, so both mutations are optimistic through
 * `optimisticUpdate` (checklist R-07): the row loses its "New" badge on
 * the tap rather than after a round trip. A failure puts the badge back
 * and says so — a silent rollback is a patient who believes they have
 * read something they have not.
 *
 * Both are scoped to `lists()` rather than the whole `notifications`
 * domain. The list is the only notification query today, so nothing
 * changes; the narrower key is what keeps it that way, because the
 * rewrite below assumes the feed's shape and a future unread-*count*
 * query under the same prefix would not have it.
 *
 * ── Paging ──────────────────────────────────────────────────────────
 *
 * The feed is twenty rows a page and this screen used to read page one.
 * `unreadCount` already compensated for that -- it reads the badge
 * endpoint rather than counting the feed, and says why -- but the list
 * itself did not, so a patient with more than twenty notifications could
 * not reach the older ones, and the tab badge could show a number larger
 * than anything on screen. "Show more" is the same control Discover and
 * Appointments use, for the same three reasons.
 *
 * Because the feed is now an infinite query its cached value is an
 * `InfiniteData<NotificationPage>`, so the optimistic rewrites map over
 * `pages`. That is the whole cost of paging here: read state stays
 * optimistic, on every page the patient has loaded.
 */
/** Marking read is idempotent: a row that is already read does not move. */
function markedRead(
  notifications: readonly PatientNotification[],
  matches: (notification: PatientNotification) => boolean,
): PatientNotification[] {
  const now = new Date().toISOString();
  return notifications.map((notification) =>
    matches(notification) && notification.readAt === null
      ? { ...notification, readAt: now }
      : notification,
  );
}

/** The inverse, for one row. Idempotent the same way. */
function markedUnread(
  notifications: readonly PatientNotification[],
  id: string,
): PatientNotification[] {
  return notifications.map((notification) =>
    notification.id === id && notification.readAt !== null
      ? { ...notification, readAt: null }
      : notification,
  );
}

/**
 * The same rewrite, applied to every page the patient has loaded.
 *
 * Marking all read has to reach page three as well as page one — the
 * badge it reconciles with counts every unread row the caller has, not
 * the ones currently rendered.
 */
type FeedCache = InfiniteData<NotificationPage>;

function markedReadAcrossPages(
  cache: FeedCache,
  matches: (notification: PatientNotification) => boolean,
): FeedCache {
  return acrossPages(cache, (items) => markedRead(items, matches));
}

function acrossPages(
  cache: FeedCache,
  rewrite: (items: readonly PatientNotification[]) => PatientNotification[],
): FeedCache {
  return { ...cache, pages: cache.pages.map((page) => ({ ...page, items: rewrite(page.items) })) };
}

export function NotificationsScreen() {
  const theme = useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  // The root navigator, not this stack: the notification centre lives
  // under Profile and an appointment lives under Appointments, so the
  // hand-off crosses tabs.
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const notifications = usePagedQuery({
    queryKey: notificationKeys.lists(),
    queryFn: (page) => notificationService.list(page),
  });

  /**
   * The tab-bar badge (O-02) reads a different query — a server-side
   * count, not this page — so marking read here has to tell it.
   *
   * It goes on `onSuccess` rather than `onSettled` for two reasons. The
   * spread above already owns `onSettled` and redefining it beside the
   * spread would silently REPLACE the list invalidation, which is the
   * failure `optimistic.ts` documents. And on failure there is nothing to
   * invalidate: the badge was never optimistically moved, so the count it
   * is showing is still the count the server holds.
   */
  const refreshBadge = () => {
    void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    ...optimisticUpdate<string, FeedCache>({
      queryClient,
      queryKey: notificationKeys.lists(),
      apply: (current, id) =>
        markedReadAcrossPages(current, (notification) => notification.id === id),
      onRollback: () => toast.show(t('notifications.markRead.failed'), 'error'),
    }),
    onSuccess: refreshBadge,
  });

  /**
   * The undo. Optimistic for the same reason marking read is: read state
   * is the patient's own, and the route is idempotent by contract.
   *
   * It does NOT touch the deep link. Putting a row back to unread is
   * about the flag, not about going anywhere, so it is a control of its
   * own rather than a second meaning for the tap that already opens
   * something (O-04).
   */
  const markUnread = useMutation({
    mutationFn: (id: string) => notificationService.markUnread(id),
    ...optimisticUpdate<string, FeedCache>({
      queryClient,
      queryKey: notificationKeys.lists(),
      apply: (current, id) => acrossPages(current, (items) => markedUnread(items, id)),
      onRollback: () => toast.show(t('notifications.markUnread.failed'), 'error'),
    }),
    onSuccess: refreshBadge,
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    ...optimisticUpdate<void, FeedCache>({
      queryClient,
      queryKey: notificationKeys.lists(),
      apply: (current) => markedReadAcrossPages(current, () => true),
      onRollback: () => toast.show(t('notifications.markAll.failed'), 'error'),
    }),
    onSuccess: refreshBadge,
  });

  /**
   * The tap. Read state first: a patient who tapped a notification has
   * seen it whether or not it takes them anywhere, and whether or not
   * the navigation succeeds.
   *
   * `useCallback` because `NotificationRow` is memoised — a new function
   * per render would re-render every row in the list on every state
   * change the screen makes.
   */
  const open = useCallback(
    (notification: PatientNotification) => {
      if (notification.readAt === null) markRead.mutate(notification.id);
      const target = notificationTarget(notification.deepLink);
      if (target !== null) navigation.navigate(...target);
    },
    [markRead, navigation],
  );

  const markUnreadRow = useCallback((id: string) => markUnread.mutate(id), [markUnread]);

  // Counted over the pages on screen, which is what the "N unread"
  // badge beside the heading is about. The TAB badge is a different
  // number from a different query -- the server's count over every
  // unread row -- and `useUnreadCount` owns it.
  const unread = notifications.data?.items.filter((item) => item.readAt === null).length ?? 0;

  return (
    <PagedList
      testID="notifications-screen"
      statesTestID="notifications-list"
      query={notifications}
      rowGap={theme.space[2]}
      onRefresh={() => void notifications.refetch()}
      renderItem={(notification) => (
        <NotificationRow notification={notification} onOpen={open} onMarkUnread={markUnreadRow} />
      )}
      empty={{
        icon: 'bell',
        title: t('notifications.empty.title'),
        body: t('notifications.empty.body'),
      }}
      paging={{
        testIDPrefix: 'notifications',
        loadMoreLabel: t('notifications.loadMore'),
        loadMoreHint: t('notifications.loadMore.hint', {
          shown: notifications.data?.items.length ?? 0,
          total: notifications.data?.totalItems ?? 0,
        }),
        endLabel: t('notifications.end', { total: notifications.data?.totalItems ?? 0 }),
      }}
      header={
        <>
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Text variant="h1" style={styles.grow} {...headingA11y(t('notifications.title'))}>
              {t('notifications.title')}
            </Text>
            {unread > 0 ? (
              <Badge label={t('notifications.unreadBadge', { count: unread })} tone="primary" />
            ) : null}
          </View>

          {unread > 0 ? (
            <Button
              label={t('notifications.markAll')}
              tone="secondary"
              testID="notifications-mark-all"
              loading={markAllRead.isPending}
              onPress={() => markAllRead.mutate()}
            />
          ) : null}
        </>
      }
      footer={
        <Card tone="sunken">
          <Text variant="bodySm" color="textTertiary">
            {t('notifications.noPush')}
          </Text>
        </Card>
      }
    />
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
