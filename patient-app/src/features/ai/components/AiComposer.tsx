import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { AiTurnState } from '../model/types';

/**
 * The composer — checklist K-02.
 *
 * ── It is disabled, and it says why on the screen ───────────────────
 *
 * `state` is `'unavailable'` everywhere it is currently mounted, which
 * means the field is not editable, Send is inert, and a line under the
 * field explains that no assistant is connected. That is the deliberate
 * choice over the two alternatives:
 *
 * - **Not rendering it at all** would leave the chat screen a page of
 *   prose, and the composer is the part of a chat interface whose
 *   layout, keyboard behaviour and accessibility most need to exist
 *   before the feature does.
 * - **Letting it accept text** would be worse still: a patient who types
 *   out their symptoms and presses Send has told the app something, and
 *   an app that takes that and does nothing with it has lied twice.
 *
 * A disabled control with a stated reason is the honest third option,
 * and it is the same pattern `NotificationPrefsScreen` uses for the push
 * channel (O-06): a switch that works while nothing is delivered is the
 * dishonest half of a working control.
 *
 * ── Why it is a bare `TextInput` and not `Input` ────────────────────
 *
 * `Input` is a labelled form field with a caption slot and a fixed
 * height — right for a form, wrong for a composer, which grows with the
 * draft and carries its label visually hidden. The border, radius,
 * disabled ink and focus treatment are all read from the same tokens
 * `Input` reads, so it matches by construction rather than by eye.
 *
 * ── The attachment control ──────────────────────────────────────────
 *
 * `onAttach` is optional and, when passed, renders the paperclip that
 * K-02 and L-01 call for. It reaches the image screen's UI; it does not
 * open a picker and there is no upload behind it (BE-15 — no object
 * storage, no malware scanning, no files service).
 */
export interface AiComposerProps {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly onSend: () => void;
  readonly state: AiTurnState;
  readonly onAttach?: () => void;
  readonly testID?: string;
}

export function AiComposer({
  value,
  onChangeText,
  onSend,
  state,
  onAttach,
  testID,
}: AiComposerProps) {
  const theme = useTheme();
  const t = useT();

  const unavailable = state === 'unavailable';
  const busy = state === 'sending' || state === 'responding';
  const editable = !unavailable && !busy;
  const canSend = editable && value.trim().length > 0;

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
        {onAttach === undefined ? null : (
          <Pressable
            testID="ai-composer-attach"
            onPress={onAttach}
            hitSlop={8}
            {...pressableA11y({
              label: t('ai.composer.attach'),
              hint: t('ai.composer.attachHint'),
            })}
            style={[
              styles.iconButton,
              {
                borderColor: theme.colors.borderStrong,
                borderRadius: theme.radius.surface,
              },
            ]}
          >
            <Icon name="paperclip" size={20} color="textSecondary" />
          </Pressable>
        )}

        <TextInput
          testID="ai-composer-input"
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          multiline
          // Room for a few lines before it scrolls; a composer that
          // grows without limit pushes the transcript off the screen.
          maxLength={2000}
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
          {t('ai.composer.disabledReason')}
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
