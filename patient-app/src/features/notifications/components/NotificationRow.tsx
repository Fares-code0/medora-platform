import { memo } from 'react';

import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Icon, Text } from '@/components';
import type { IconName } from '@/components/Icon';
import { useT, useDateFormat } from '@/i18n';
import { useTheme } from '@/theme';
import type { NotificationCategory } from '@/types/vocabularies';

import { notificationTarget } from '../deep-link';
import type { PatientNotification } from '../model/types';

const CATEGORY_ICON: Record<NotificationCategory, IconName> = {
  appointments: 'calendar',
  'medical-records': 'fileText',
  laboratory: 'lab',
  pharmacy: 'pill',
  patients: 'user',
  ai: 'activity',
  system: 'settings',
  security: 'shield',
};

/**
 * The hint says what the tap DOES, and that differs by row: a linked
 * notification opens something, an unlinked one only marks read. A single
 * hint would be wrong for half the list, and a screen-reader user would
 * be the one it was wrong for.
 */
function hintFor(
  t: ReturnType<typeof useT>,
  notification: PatientNotification,
  isUnread: boolean,
): string | undefined {
  if (notificationTarget(notification.deepLink) !== null) {
    return isUnread ? t('notifications.open.hint.unread') : t('notifications.open.hint');
  }
  return isUnread ? t('notifications.markRead.hint') : undefined;
}

export interface NotificationRowProps {
  readonly notification: PatientNotification;
  /** Mark read, and go wherever the row points. */
  readonly onOpen: (notification: PatientNotification) => void;
  readonly onMarkUnread: (id: string) => void;
}

/**
 * One row of the notification centre.
 *
 * Extracted from `NotificationsScreen` when the feed became a windowed
 * list: a `FlatList` re-renders a cell whenever its props change, and a
 * row that is a closure inside the screen changes on every keystroke the
 * screen's state takes. `memo` here means a row re-renders when *its*
 * notification changes — which is what an optimistic read-state flip
 * does, and nothing else.
 *
 * Unread is carried by a tinted surface AND a "New" badge, not by
 * boldness alone: a font-weight difference is not a reliable signal at
 * large accessibility text sizes, where everything is already heavy.
 */
export const NotificationRow = memo(function NotificationRow({
  notification,
  onOpen,
  onMarkUnread,
}: NotificationRowProps) {
  const theme = useTheme();
  const { formatRelative } = useDateFormat();
  const t = useT();
  const isUnread = notification.readAt === null;

  return (
    <Card
      testID={`notification-${notification.id}`}
      tone={isUnread ? 'primary' : 'default'}
      onPress={() => onOpen(notification)}
      // The title and body are the server's own words, in whatever
      // language it sent them; only the "Unread" prefix is this app's to
      // translate. A read row gets no frame at all, so it needs no key —
      // a key whose whole value is `{title}. {body}` would be the same
      // string in every language, which `i18n.test.tsx` rejects and is
      // right to.
      accessibilityLabel={
        isUnread
          ? t('notifications.unread.a11y', {
              title: notification.title,
              body: notification.body,
            })
          : `${notification.title}. ${notification.body}`
      }
      accessibilityHint={hintFor(t, notification, isUnread)}
    >
      <View style={[styles.row, { columnGap: theme.space[3] }]}>
        <Icon
          name={CATEGORY_ICON[notification.category]}
          size={20}
          color={notification.priority === 'critical' ? 'error' : 'textSecondary'}
        />
        <View style={[styles.grow, { rowGap: theme.space[1] }]}>
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Text variant="bodyStrong" style={styles.grow}>
              {notification.title}
            </Text>
            {isUnread ? <Badge label={t('notifications.new')} tone="primary" /> : null}
          </View>
          <Text variant="bodySm" color="textSecondary">
            {notification.body}
          </Text>
          <Text variant="caption" color="textTertiary">
            {formatRelative(notification.createdAt)}
          </Text>

          {/*
            Read rows only. On an unread row the control would be a no-op
            with a label that promised something, and `POST /{id}/unread`
            on an already-unread row is a request that cannot change
            anything.
          */}
          {isUnread ? null : (
            <View style={styles.undo}>
              <Button
                label={t('notifications.markUnread')}
                tone="secondary"
                size="sm"
                testID={`notification-${notification.id}-mark-unread`}
                hint={t('notifications.markUnread.hint')}
                onPress={() => onMarkUnread(notification.id)}
              />
            </View>
          )}
        </View>
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
  // `flex-start` rather than a full-width button: the control belongs to
  // one row and should not read as the card's primary action.
  undo: { alignItems: 'flex-start' },
});
