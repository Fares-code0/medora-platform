import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { createKeyFactory } from '@/api/query-keys';
import { AsyncBoundary, Avatar, Badge, Card, Icon, Screen, Text } from '@/components';
import { useT, useDateFormat } from '@/i18n';
import type { MessagesStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import type { ConversationSummary } from '../model/types';
import { messagingService } from '../service';

type Props = NativeStackScreenProps<MessagesStackParamList, 'MessagesRoot'>;

export const messageKeys = createKeyFactory('messages');

/**
 * Who the thread is with, as one phrase.
 *
 * Both the clinic's own words, so there is no catalogue key: the comma is
 * the only thing this adds, and it is what makes a screen reader pause
 * between the name and the department instead of running them together.
 */
function spokenName(conversation: ConversationSummary): string {
  return conversation.subtitle === null
    ? conversation.title
    : `${conversation.title}, ${conversation.subtitle}`;
}

/**
 * The conversation list.
 *
 * ── The subtitle is the department, and it earns its line ────────────
 *
 * `ConversationSummary.subtitle` was fetched and rendered nowhere, here or
 * in the thread. It is the clinician's department — "Cardiology", "Admin" —
 * and without it a list of two clinicians with similar names gives a
 * patient nothing to tell them apart. It is in the accessibility label for
 * the same reason, folded into the `title` parameter rather than given a
 * parameter of its own, so a screen reader hears what the screen shows.
 *
 * The banner at the top is not decoration. Messaging is the surface a
 * worried patient reaches for at 2am, and a clinician may not read a
 * thread for a day or more. `MessageFlag` already has an
 * `emergency_language` category on the backend, which is the clinic's
 * side of the same problem; this is the patient's side, said before they
 * type rather than after (checklist M-05).
 */
export function MessagesScreen({ navigation }: Props) {
  const theme = useTheme();
  const { formatRelative } = useDateFormat();
  const t = useT();
  const conversations = useQuery({
    queryKey: messageKeys.lists(),
    queryFn: () => messagingService.listConversations(),
  });

  return (
    <Screen
      testID="messages-screen"
      onRefresh={() => void conversations.refetch()}
      refreshing={conversations.isRefetching}
    >
      <Text variant="h1" {...headingA11y(t('messages.title'))}>
        {t('messages.title')}
      </Text>

      {/* English, deliberately: it tells a patient what to do when
          something is urgent or an emergency, which is clinically
          reviewed material under N-07 and W-10. `messages/en.ts` states
          the rule; everything else on this screen is translated. */}
      <Card tone="warning" testID="messages-urgency-notice">
        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          <Icon name="alert" size={18} color="warning" />
          <Text variant="bodySm" color="textSecondary" style={styles.grow}>
            Messages are not urgent care. A clinician may not read this for a day or more. If
            something is urgent, call the clinic; if it is an emergency, use Emergency help.
          </Text>
        </View>
      </Card>

      <AsyncBoundary
        testID="messages-list"
        query={conversations}
        isEmpty={(data) => data.length === 0}
        empty={{
          icon: 'message',
          title: t('messages.empty.title'),
          body: t('messages.empty.body'),
        }}
      >
        {(data) => (
          <View style={{ rowGap: theme.space[2] }}>
            {data.map((conversation) => (
              <Card
                key={conversation.id}
                testID={`conversation-${conversation.id}`}
                onPress={() => navigation.navigate('Thread', { conversationId: conversation.id })}
                // With nothing unread there is no frame to translate —
                // the title and the preview are the clinic's own words —
                // so there is no key, for the same reason a read
                // notification has none.
                accessibilityLabel={
                  conversation.unreadCount > 0
                    ? t('messages.conversation.a11yUnread', {
                        title: spokenName(conversation),
                        count: conversation.unreadCount,
                        preview: conversation.lastMessagePreview,
                      })
                    : `${spokenName(conversation)}. ${conversation.lastMessagePreview}`
                }
                accessibilityHint={t('messages.conversation.hint')}
              >
                <View style={[styles.row, { columnGap: theme.space[3] }]}>
                  <Avatar name={conversation.title} />
                  <View style={[styles.grow, { rowGap: theme.space[1] }]}>
                    <View style={[styles.row, { columnGap: theme.space[2] }]}>
                      <Text variant="bodyStrong" style={styles.grow} numberOfLines={1}>
                        {conversation.title}
                      </Text>
                      {conversation.unreadCount > 0 ? (
                        <Badge
                          label={
                            conversation.unreadCount > 99 ? '99+' : String(conversation.unreadCount)
                          }
                          tone="primary"
                        />
                      ) : null}
                    </View>
                    {conversation.subtitle === null ? null : (
                      <Text variant="caption" color="textTertiary" numberOfLines={1}>
                        {conversation.subtitle}
                      </Text>
                    )}
                    <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
                      {conversation.lastMessagePreview}
                    </Text>
                    <Text variant="caption" color="textTertiary">
                      {formatRelative(conversation.lastMessageAt)}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </AsyncBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
