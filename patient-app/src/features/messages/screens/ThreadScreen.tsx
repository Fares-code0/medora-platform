import { useEffect, useState } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { AsyncBoundary, Badge, Button, Icon, Input, Screen, Text } from '@/components';
import { useKeyboardAvoidance } from '@/components/layout/screen-content';
import { useT, type MessageKey, useDateFormat } from '@/i18n';
import type { MessagesStackParamList, RootStackParamList } from '@/navigation/routes';
import { useNetworkStatus } from '@/network/NetworkProvider';
import { useTheme } from '@/theme';
import type { MessageStatus } from '@/types/vocabularies';

import type { Message } from '../model/types';
import { messagingService } from '../service';

import { messageKeys } from './MessagesScreen';

type Props = NativeStackScreenProps<MessagesStackParamList, 'Thread'>;

const STATUS_KEY: Record<MessageStatus, MessageKey> = {
  sending: 'thread.status.sending',
  sent: 'thread.status.sent',
  delivered: 'thread.status.delivered',
  read: 'thread.status.read',
  failed: 'thread.status.failed',
};

/**
 * One thread.
 *
 * ── What is here ─────────────────────────────────────────────────────
 * Bubbles with delivery status, a keyboard-aware composer, an emergency
 * route in the composer area, and an offline state that **refuses to
 * send** rather than queueing (audit §12.4). A message queued offline and
 * delivered three hours later, after the patient assumed it had gone, is
 * worse than a refusal they can see.
 *
 * ── What is deliberately absent ──────────────────────────────────────
 * **No delete affordance.** Delete is `405` in patient threads and the
 * operation is archive (DB §7). A button that produced a 405 would be a
 * feature the UI promises and the server refuses.
 *
 * **No edit control yet.** The 5-minute window is a platform setting the
 * server sends as `editableUntil`; a client that hardcoded five minutes
 * would disagree with the server the day the setting changes.
 *
 * ── And no composer at all on a closed thread ────────────────────────
 *
 * `Conversation.readOnly` is the server saying this thread is closed.
 * It was fetched and ignored, so a closed thread rendered a live Input
 * and an enabled Send — which is the same mistake as a delete button
 * this file argues against two paragraphs up: a feature the UI promises
 * and the server refuses. Worse than the 405, in fact, because the cost
 * is a message the patient believed they had written.
 *
 * So the composer is replaced by a statement of why, and the **Emergency
 * route stays** — M-05 is about a patient who needs help now, and a
 * thread being archived is not a reason to take away the one affordance
 * that does not depend on a reply. The attachments note goes: it explains
 * a control that is no longer there.
 */
function MessageBubble({ message }: { message: Message }) {
  const theme = useTheme();
  const { formatDateTime } = useDateFormat();
  const t = useT();
  const failed = message.status === 'failed';
  const status = t(STATUS_KEY[message.status]);

  return (
    <View
      accessible
      accessibilityLabel={t('thread.message.a11y', {
        author: message.authorName,
        when: formatDateTime(message.sentAt),
        body: message.body,
        status,
      })}
      style={[styles.bubbleRow, { justifyContent: message.mine ? 'flex-end' : 'flex-start' }]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: message.mine ? theme.colors.primarySubtle : theme.colors.surface,
            borderColor: failed ? theme.colors.error : theme.colors.border,
            borderRadius: theme.radius.surface,
            padding: theme.space[3],
            rowGap: theme.space[1],
          },
        ]}
      >
        {message.mine ? null : (
          <Text variant="caption" color="textTertiary">
            {message.authorName}
          </Text>
        )}
        <Text variant="body">{message.body}</Text>
        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          <Text variant="caption" color="textTertiary" style={styles.grow}>
            {formatDateTime(message.sentAt)}
          </Text>
          {message.editedAt === null ? null : (
            <Text variant="caption" color="textTertiary">
              {t('thread.message.edited')}
            </Text>
          )}
          {message.mine ? <Badge label={status} tone={failed ? 'error' : 'neutral'} /> : null}
        </View>
      </View>
    </View>
  );
}

export function ThreadScreen({ route }: Props) {
  const theme = useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  const rootNavigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { isOnline } = useNetworkStatus();
  const { conversationId } = route.params;
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const conversation = useQuery({
    queryKey: messageKeys.detail(conversationId),
    queryFn: () => messagingService.getConversation(conversationId),
  });

  /**
   * Mark-read — checklist M-04.
   *
   * Opening a thread is the act that makes it read; there is no separate
   * control, because a "mark as read" button beside a thread a patient
   * is looking at is a control for something that already happened.
   *
   * Three decisions worth stating, because each has a wrong version that
   * looks reasonable:
   *
   * - **The trigger is the count, not the mount.** A thread a patient has
   *   already read is not an event, so opening one writes nothing — and
   *   a message that arrives while they are still reading *is* one, so it
   *   is marked read too. A "once per mount" guard would get the first
   *   case right and the second wrong, leaving a thread the patient is
   *   looking at reported as unread. The effect cannot loop: its
   *   dependency is the count, which only moves when the server says so.
   * - **A failure is silent.** This is a side effect of reading, not the
   *   content: the messages are on the screen either way, and a banner
   *   saying "could not mark as read" over a thread a patient is reading
   *   is noise about the server's bookkeeping. The row simply stays
   *   unread, which is true — and, the count being unchanged, nothing
   *   retries until it moves.
   * - **It invalidates the LIST, not this thread.** The unread count
   *   lives on the conversation summary, and refetching the thread a
   *   patient is reading to update a number they cannot see would move
   *   the screen under them.
   *
   * What this does NOT do is put a badge on the Messages tab. The
   * notifications badge reads `GET /notifications/badge-counts`; there is
   * no such endpoint for conversations, and summing `unreadCount` across
   * a page of a list would report a number that is smaller than the
   * truth the moment there is a second page — the exact defect F-07's
   * rule avoids. It stays absent until BE-13 provides a count.
   */
  const { mutate: markConversationRead } = useMutation({
    mutationFn: () => messagingService.markRead(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: messageKeys.lists() });
    },
  });

  const unreadCount = conversation.data?.unreadCount ?? 0;

  useEffect(() => {
    if (unreadCount === 0) return;
    markConversationRead();
  }, [unreadCount, markConversationRead]);

  /**
   * Undefined while the thread loads, and that is deliberately NOT
   * treated as read-only: a composer that appears a beat after the
   * screen does is worse than one that is there from the start, and the
   * send button is already disabled on an empty draft.
   */
  const readOnly = conversation.data?.readOnly === true;

  const send = useMutation({
    mutationFn: (body: string) => messagingService.send(conversationId, body),
    onSuccess: () => {
      setDraft('');
      setFailure(null);
      void queryClient.invalidateQueries({ queryKey: messageKeys.all });
    },
    onError: () => {
      // Visibly failed and retryable, never silently lost (M-03).
      setFailure(t('thread.sendFailed'));
    },
  });

  const keyboardAvoidance = useKeyboardAvoidance();

  return (
    <KeyboardAvoidingView style={styles.fill} {...keyboardAvoidance}>
      <Screen testID="thread-screen" padded>
        {/*
          The heading is outside the boundary — `A11Y_AUDIT` F-7.

          F-3 put a heading on this screen and put it in the success
          branch, which left three states without one: while the thread
          loads, if it fails, and — the one a patient actually reaches —
          when the conversation exists and has **no messages yet**, where
          `AsyncBoundary` renders an empty state and nothing names the
          screen. Hoisted, it names the clinician as soon as the
          conversation is known and falls back to the screen's own name
          before that.
        */}
        <Text
          variant="h2"
          {...headingA11y(
            conversation.data === undefined
              ? t('nav.title.conversation')
              : t('thread.a11y', { name: conversation.data.title }),
          )}
        >
          {conversation.data?.title ?? t('nav.title.conversation')}
        </Text>

        <AsyncBoundary
          testID="thread"
          query={conversation}
          isEmpty={(data) => data.messages.length === 0}
          empty={{
            icon: 'message',
            title: t('thread.empty.title'),
            body: t('thread.empty.body'),
          }}
        >
          {(data) => (
            <View style={{ rowGap: theme.space[3] }}>
              {data.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </View>
          )}
        </AsyncBoundary>
      </Screen>

      <View
        style={[
          styles.composer,
          {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
            padding: theme.screenGutter,
            rowGap: theme.space[2],
          },
        ]}
      >
        {failure === null ? null : (
          <Text variant="caption" color="error" accessibilityLiveRegion="assertive">
            {failure}
          </Text>
        )}

        {isOnline || readOnly ? null : (
          <Text variant="caption" color="warning">
            {t('thread.offline')}
          </Text>
        )}

        {readOnly ? (
          <View testID="thread-closed" style={{ rowGap: theme.space[1] }}>
            <View style={[styles.row, { columnGap: theme.space[2] }]}>
              <Icon name="lock" size={14} color="textSecondary" />
              <Text variant="label" color="textSecondary">
                {t('thread.closed.title')}
              </Text>
            </View>
            <Text variant="caption" color="textTertiary">
              {t('thread.closed.body')}
            </Text>
          </View>
        ) : (
          <Input
            label={t('thread.composer.label')}
            testID="thread-composer"
            value={draft}
            onChangeText={setDraft}
            multiline
            disabled={!isOnline}
            placeholder={t('thread.composer.placeholder')}
          />
        )}

        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          {/*
            Always present, closed thread or not — M-05 is about someone
            who needs help now, and an archived conversation is not a
            reason to remove the one route that never waited for a reply.
          */}
          <Button
            label="Emergency"
            tone="ghost"
            icon="alert"
            testID="thread-emergency"
            onPress={() => rootNavigation.navigate('Emergency')}
            hint="Messages are not urgent care"
          />
          <View style={styles.grow} />
          {readOnly ? null : (
            <Button
              label={t('thread.send')}
              icon="send"
              testID="thread-send"
              disabled={draft.trim().length === 0 || !isOnline}
              loading={send.isPending}
              onPress={() => send.mutate(draft.trim())}
            />
          )}
        </View>

        {readOnly ? null : (
          <View style={[styles.row, { columnGap: theme.space[1] }]}>
            <Icon name="paperclip" size={12} color="textDisabled" />
            <Text variant="caption" color="textDisabled">
              {t('thread.attachments')}
            </Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: { borderWidth: 1, maxWidth: '85%' },
  bubbleRow: { flexDirection: 'row' },
  composer: { borderTopWidth: 1 },
  fill: { flex: 1 },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
