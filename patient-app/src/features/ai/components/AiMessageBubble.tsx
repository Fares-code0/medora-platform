import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text } from '@/components';
import { useDateFormat, useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { AiMessage } from '../model/types';

/**
 * One turn in the transcript — checklist K-02's message list.
 *
 * ── A pure component, deliberately ──────────────────────────────────
 *
 * It takes a message and draws it. It does not fetch, generate, stream
 * or store one, and nothing in this tree constructs an `assistant`
 * message to hand it — see `availability.ts`. It exists so that the
 * transcript is designed, accessible and translated before there is
 * anything to put in it, and `ai-states.test.tsx` renders it in every
 * state directly rather than through a screen that would have to invent
 * a conversation to do so.
 *
 * ── Author is carried three ways, not one ───────────────────────────
 *
 * Alignment, colour and fill all distinguish the two authors, and none
 * of them is the carrier: a screen reader gets the author as **words**
 * in `accessibilityLabel` ("Medora Assistant said: …"), because "who
 * said this" is the single most important fact about a sentence on a
 * medical screen and alignment conveys nothing to VoiceOver (WCAG
 * 1.4.1, checklist S-02).
 *
 * The assistant's bubble also carries a machine icon and a named
 * attribution line. A patient must not be able to lose track of the fact
 * that the other party is software — that is K-03's rule applied to the
 * transcript itself rather than to the banner above it.
 *
 * ── The failed state ────────────────────────────────────────────────
 *
 * A turn that did not complete stays visible, in error tone, with what
 * the patient wrote still in it and a retry beside it. Losing what
 * somebody just typed about their health is not an acceptable failure
 * mode — the same rule `features/messages` M-03 is held to.
 */
export interface AiMessageBubbleProps {
  readonly message: AiMessage;
  /** Marks the turn as not delivered, and shows the retry. */
  readonly failed?: boolean;
  readonly onRetry?: () => void;
  readonly testID?: string;
}

export function AiMessageBubble({ message, failed = false, onRetry, testID }: AiMessageBubbleProps) {
  const theme = useTheme();
  const t = useT();
  // The app's locale, not the device's — a patient can set Medora to
  // Arabic on an English phone, and a timestamp is copy like any other.
  const { formatTime } = useDateFormat();
  const fromPatient = message.author === 'patient';

  const author = fromPatient ? t('ai.chat.author.you') : t('ai.chat.author.assistant');
  const time = formatTime(message.at);
  const label = failed
    ? t('ai.chat.bubble.failedA11y', { author, body: message.body })
    : t('ai.chat.bubble.a11y', { author, body: message.body, time });

  const background = failed
    ? theme.colors.errorSubtle
    : fromPatient
      ? theme.colors.primarySubtle
      : theme.colors.surface;
  const border = failed
    ? theme.colors.error
    : fromPatient
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View
      testID={testID ?? `ai-message-${message.id}`}
      style={[styles.row, fromPatient ? styles.alignEnd : styles.alignStart]}
    >
      <View
        accessible
        accessibilityLabel={label}
        style={[
          styles.bubble,
          {
            backgroundColor: background,
            borderColor: border,
            borderRadius: theme.radius.surface,
            padding: theme.space[3],
            rowGap: theme.space[1],
          },
        ]}
      >
        {fromPatient ? null : (
          <View style={[styles.attribution, { columnGap: theme.space[1] }]}>
            <Icon name="cpu" size={14} color="textTertiary" />
            <Text variant="caption" color="textTertiary">
              {author}
            </Text>
          </View>
        )}

        <Text variant="body">{message.body}</Text>

        {failed ? (
          <Text variant="caption" color="error" testID="ai-message-failed">
            {t('ai.chat.bubble.failed')}
          </Text>
        ) : (
          <Text variant="caption" color="textDisabled">
            {time}
          </Text>
        )}
      </View>

      {failed && onRetry !== undefined ? (
        <Button
          testID="ai-message-retry"
          label={t('action.retry')}
          tone="ghost"
          size="sm"
          icon="refresh"
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  alignEnd: { alignItems: 'flex-end' },
  alignStart: { alignItems: 'flex-start' },
  attribution: { alignItems: 'center', flexDirection: 'row' },
  // 88%, not 100%: a bubble that reaches both edges stops reading as a
  // turn in a conversation and starts reading as body copy.
  bubble: { borderWidth: 1, maxWidth: '88%' },
  row: { rowGap: 4, width: '100%' },
});
