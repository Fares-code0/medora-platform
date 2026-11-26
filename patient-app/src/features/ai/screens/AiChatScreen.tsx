import { useEffect, useRef, useState } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { useAnnounceOnChange } from '@/accessibility/useAnnounceOnChange';
import { Button, EmptyState, ErrorState, Text } from '@/components';
import { useKeyboardAvoidance } from '@/components/layout/screen-content';
import { NotLinkedNotice } from '@/features/health/components/NotLinkedNotice';
import { isPatientNotLinked } from '@/features/health/not-linked';
import { useT } from '@/i18n';
import type { HomeStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { AiComposer } from '../components/AiComposer';
import { AiDisclaimer } from '../components/AiDisclaimer';
import { AiEscalationCard } from '../components/AiEscalationCard';
import { AiMessageBubble } from '../components/AiMessageBubble';
import { AiSafetyCard } from '../components/AiSafetyCard';
import { AiTypingIndicator } from '../components/AiTypingIndicator';
import { AiUnavailableNotice } from '../components/AiUnavailableNotice';
import { useAiConversation } from '../hooks';
import { useAiChat } from '../useAiChat';

type Props = NativeStackScreenProps<HomeStackParamList, 'AiChat'>;
type AiNavigation = NavigationProp<HomeStackParamList & RootStackParamList>;

/**
 * A conversation with one of the two assistants.
 *
 * ── What is on screen, top to bottom ────────────────────────────────
 *
 * The mode's disclaimer (outside the scroll, so it is never scrolled
 * away — K-03); the transcript; the safety card; the composer. Which of
 * five things replaces the composer or sits above it depends on what the
 * server said:
 *
 * - **503** → `AiUnavailableNotice` in place of the composer. No fake
 *   reply, no retry loop: the assistant is off.
 * - **409 `patient_not_linked`** (personal mode) → the link notice, with
 *   the typed text left in the field.
 * - **a server escalation** → `AiEscalationCard`, prominently, with the
 *   Emergency screen one tap away. The text is the server's.
 * - **a failed or cut-off turn** → an inline notice with Retry.
 * - **a reply in progress** → the typing indicator; the composer is
 *   read-only until it ends (one turn at a time).
 *
 * ── Announcements ────────────────────────────────────────────────────
 *
 * Streamed text is NOT read out token by token — that would be noise.
 * When a reply finishes, a polite live region says so; an escalation is
 * announced assertively in full (the card is an `alert`, and iOS gets
 * `announce` through `useAnnounceOnChange`, which is a no-op on Android
 * where the live region already speaks).
 *
 * The draft is `useState`: never persisted, never restored. What a
 * patient types about their own care is PHI and this client writes none
 * to disk (T-03); the transcript lives on the server (K-07).
 */
export function AiChatScreen({ route }: Props) {
  const { mode, conversationId: openedId } = route.params;
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<AiNavigation>();
  const keyboardAvoidance = useKeyboardAvoidance();
  const scroll = useRef<ScrollViewInstance | null>(null);

  const chat = useAiChat(mode, openedId);
  const history = useAiConversation(openedId);
  const [draft, setDraft] = useState('');
  const [arrived, setArrived] = useState(0);

  const { hydrate } = chat;
  const loaded = history.data;
  useEffect(() => {
    if (loaded !== undefined) hydrate(loaded.messages);
  }, [loaded, hydrate]);

  const last = chat.messages[chat.messages.length - 1];
  const escalationBody = last?.escalated === true ? last.body : undefined;
  useAnnounceOnChange(escalationBody);

  const notLinked = isPatientNotLinked(chat.error) || isPatientNotLinked(history.error);
  const unavailable = chat.turn === 'unavailable';
  const busy = chat.turn === 'sending' || chat.turn === 'responding';
  const showReplyStatus = arrived > 0 && last?.author === 'assistant' && last.escalated !== true;
  const title = t(mode === 'personal' ? 'ai.chat.title.personal' : 'ai.chat.title.general');

  const send = () => {
    const text = draft;
    void chat.send(text).then((accepted) => {
      if (accepted) setDraft((current) => (current === text ? '' : current));
    });
  };

  const emergency = () => navigation.navigate('Emergency');

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
      {...keyboardAvoidance}
    >
      <View style={{ padding: theme.screenGutter, paddingBottom: 0 }}>
        <AiDisclaimer mode={mode} />
      </View>

      <ScrollView
        ref={scroll}
        testID="ai-chat-screen"
        style={styles.fill}
        contentContainerStyle={{ padding: theme.screenGutter, rowGap: theme.space[3] }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        <Text variant="h2" {...headingA11y(title)}>
          {title}
        </Text>

        {openedId !== undefined && history.isError && !notLinked ? (
          <ErrorState
            testID="ai-chat-history-error"
            error={history.error}
            onRetry={() => void history.refetch()}
          />
        ) : null}

        {chat.messages.length === 0 && !unavailable && !notLinked && !history.isError ? (
          <EmptyState
            testID="ai-chat-empty"
            icon="message"
            title={t(
              mode === 'personal' ? 'ai.chat.empty.personal.title' : 'ai.chat.empty.general.title',
            )}
            body={t(
              mode === 'personal' ? 'ai.chat.empty.personal.body' : 'ai.chat.empty.general.body',
            )}
          />
        ) : null}

        {chat.messages.map((message) =>
          message.escalated === true ? (
            <AiEscalationCard
              key={message.id}
              testID={`ai-escalation-${message.id}`}
              body={message.body}
              onEmergency={emergency}
            />
          ) : (
            <AiMessageBubble
              key={message.id}
              message={message}
              failed={chat.turn === 'failed' && message === lastPatient(chat.messages)}
            />
          ),
        )}

        {chat.turn === 'sending' || chat.turn === 'responding' ? (
          <AiTypingIndicator testID="ai-typing" />
        ) : null}

        {chat.turn === 'failed' ? (
          <View
            testID="ai-chat-failed"
            accessibilityLiveRegion="polite"
            style={{ rowGap: theme.space[2] }}
          >
            <Text variant="bodySm" color="error">
              {t('ai.chat.failed')}
            </Text>
            <Button
              testID="ai-chat-retry"
              label={t('action.retry')}
              tone="secondary"
              icon="refresh"
              onPress={chat.retry}
            />
          </View>
        ) : null}

        {showReplyStatus ? (
          <Text
            key={arrived}
            variant="caption"
            color="textTertiary"
            testID="ai-chat-reply-status"
            accessibilityLiveRegion="polite"
          >
            {t('ai.chat.replyArrived')}
          </Text>
        ) : null}

        {notLinked ? <NotLinkedNotice /> : null}
        {unavailable ? <AiUnavailableNotice /> : null}

        <AiSafetyCard
          onEmergency={emergency}
          onFindCare={() =>
            navigation.navigate('Tabs', {
              screen: 'DiscoverTab',
              params: { screen: 'DiscoverRoot' },
            })
          }
        />
      </ScrollView>

      <AiComposer
        value={draft}
        onChangeText={setDraft}
        onSend={send}
        state={unavailable ? 'unavailable' : busy ? chat.turn : notLinked ? 'unavailable' : 'idle'}
      />
    </KeyboardAvoidingView>
  );
}

/** The most recent message the patient sent — the one a failed turn belongs to. */
function lastPatient<T extends { readonly author: string }>(messages: readonly T[]): T | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.author === 'patient') return message;
  }
  return undefined;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
