import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { AI_MESSAGE_MAX_LENGTH, type AiTurnState } from '../model/types';

/**
 * The composer — checklist K-02.
 *
 * ── Its states ──────────────────────────────────────────────────────
 *
 * - `idle` and `failed`: editable; Send enabled once there is text.
 * - `sending` / `responding`: read-only and Send busy — one turn at a
 *   time. The hook holds the real re-entrancy guard; this is the part a
 *   patient can see.
 * - `unavailable`: the server answered 503. The field is not editable,
 *   Send is inert, and a line under it says why ON the screen rather
 *   than only in a hint — a disabled control whose explanation is
 *   screen-reader-only is a dead button for everybody else.
 *
 * The input is capped at 2000 characters (`AI_MESSAGE_MAX_LENGTH`, the
 * server's limit) and a counter appears only near the cap.
 *
 * There is no attachment control: the assistant takes text only. Photos
 * have no upload path (BE-15) and the photo screen was removed rather
 * than left as a surface that accepts input and does nothing with it.
 *
 * ── Why it is a bare `TextInput` and not `Input` ────────────────────
 *
 * `Input` is a labelled form field with a caption slot and a fixed
 * height — right for a form, wrong for a composer, which grows with the
 * draft and carries its label visually hidden. The border, radius,
 * disabled ink and focus treatment are all read from the same tokens
 * `Input` reads, so it matches by construction rather than by eye.
 */
export interface AiComposerProps {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly onSend: () => void;
  readonly state: AiTurnState;
  readonly testID?: string;
}

export function AiComposer({
  value,
  onChangeText,
  onSend,
  state,
  testID,
}: AiComposerProps) {
  const theme = useTheme();
  const t = useT();

  const unavailable = state === 'unavailable';
  const busy = state === 'sending' || state === 'responding';
  const editable = !unavailable && !busy;
  const canSend = editable && value.trim().length > 0;
  // Only near the limit: a counter on an empty box is noise.
  const nearLimit = value.length >= AI_MESSAGE_MAX_LENGTH * 0.9;

  return (
    <View
      testID={testID ?? 'ai-composer'}
      style={[
        styles.wrapper,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          padding: theme.space[3],
          rowGap: theme.space[2],
        },
      ]}
    >
      <View style={[styles.row, { columnGap: theme.space[2] }]}>
        <TextInput
          testID="ai-composer-input"
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          multiline
          // Room for a few lines before it scrolls; a composer that
          // grows without limit pushes the transcript off the screen.
          maxLength={AI_MESSAGE_MAX_LENGTH}
          placeholder={unavailable ? t('ai.composer.disabled') : t('ai.composer.placeholder')}
          placeholderTextColor={theme.colors.textDisabled}
          accessibilityLabel={t('ai.composer.label')}
          accessibilityHint={unavailable ? t('ai.composer.disabledHint') : undefined}
          accessibilityState={{ disabled: !editable }}
          style={[
            styles.input,
            {
              backgroundColor: editable ? theme.colors.surface : theme.colors.surfaceSunken,
              borderColor: theme.colors.borderStrong,
              borderRadius: theme.radius.surface,
              color: editable ? theme.colors.textPrimary : theme.colors.textDisabled,
              paddingHorizontal: theme.space[3],
              paddingVertical: theme.space[2],
              ...theme.typography.body,
            },
          ]}
        />

        <Pressable
          testID="ai-composer-send"
          onPress={canSend ? onSend : undefined}
          disabled={!canSend}
          hitSlop={8}
          {...pressableA11y({
            label: t('ai.composer.send'),
            disabled: !canSend,
            busy,
            ...(unavailable ? { hint: t('ai.composer.disabledHint') } : {}),
          })}
          style={[
            styles.iconButton,
            {
              backgroundColor: canSend ? theme.colors.primary : theme.colors.surfaceSunken,
              borderColor: canSend ? theme.colors.primary : theme.colors.border,
              borderRadius: theme.radius.surface,
            },
          ]}
        >
          <Icon name="send" size={20} color={canSend ? 'textInverse' : 'textDisabled'} />
        </Pressable>
      </View>

      {/* The reason, on the screen rather than only in a hint — a
          disabled control whose explanation is screen-reader-only is a
          dead button for everybody else. */}
      {unavailable ? (
        <Text variant="caption" color="textTertiary" testID="ai-composer-reason">
          {t('ai.composer.disabledHint')}
        </Text>
      ) : nearLimit ? (
        <Text
          variant="caption"
          color="textTertiary"
          testID="ai-composer-counter"
          accessibilityLiveRegion="polite"
        >
          {t('ai.composer.counter', { count: value.length, max: AI_MESSAGE_MAX_LENGTH })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: 'center',
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  input: { borderWidth: 1, flex: 1, maxHeight: 120, minHeight: 44 },
  row: { alignItems: 'flex-end', flexDirection: 'row' },
  wrapper: { borderTopWidth: 1 },
});
