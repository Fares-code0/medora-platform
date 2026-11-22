import { useState, type Ref } from 'react';

import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { useAnnounceOnChange } from '@/accessibility/useAnnounceOnChange';
import { useTheme } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

/**
 * The text field.
 *
 * ── The states, and why each is drawn the way it is ──────────────────
 * - **default** — `borderStrong`, which is held at >=3:1 against surface,
 *   page and sunken in both themes (WCAG 1.4.11). The web app's original
 *   #cbd5e1 was 1.48:1, i.e. every input was below spec; the ported
 *   token is the fix and must not be lightened.
 * - **focused** — a 2px `focusRing` border. RN has no `box-shadow`, so the
 *   web's two-layer focus ring becomes a thicker border of the same
 *   colour. Focus is never carried by colour alone: the border also
 *   changes width.
 * - **error** — `error` border AND a message AND `accessibilityInvalid`.
 *   Three carriers, because red alone fails for the ~8% of men with a
 *   red-green deficiency (WCAG 1.4.1).
 * - **disabled** — sunken background, disabled ink, and `editable={false}`.
 *
 * ── `inputRef`, and why it is a prop rather than a `ref` ─────────────
 * Moving focus from one field to the next needs a handle on the native
 * input (checklist S-05). `Input` is wrapped by `ControlledInput`, which
 * is itself generic over the form's value type, and threading a real
 * `ref` through two generic wrappers costs two `forwardRef`s and a cast
 * to keep the generic. A named prop crosses both without either, and it
 * is the same handle.
 *
 * ── Error announcement ───────────────────────────────────────────────
 * The message is bound with `accessibilityLabelledBy`-equivalent
 * semantics: it sits inside the same accessible group as the field and is
 * announced when focus lands. A field whose error is only visible is a
 * field a screen-reader user cannot fix (checklist S-02).
 */
export interface InputProps extends Omit<
  TextInputProps,
  'style' | 'onChangeText' | 'value' | 'editable'
> {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly error?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly secure?: boolean;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly testID?: string;
  /** The native input, for moving focus between fields. See above. */
  readonly inputRef?: Ref<TextInputInstance>;
}

export function Input({
  label,
  value,
  onChangeText,
  error,
  hint,
  disabled = false,
  required = false,
  secure = false,
  keyboardType,
  testID,
  inputRef,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useAnnounceOnChange(error);

  const borderColor = error
    ? theme.colors.error
    : focused
      ? theme.colors.focusRing
      : disabled
        ? theme.colors.border
        : theme.colors.borderStrong;

  return (
    <View style={{ rowGap: theme.space[1] }}>
      <Text variant="label" color={disabled ? 'textDisabled' : 'textSecondary'}>
        {required ? `${label} *` : label}
      </Text>

      <View
        style={[
          styles.field,
          {
            borderColor,
            borderWidth: focused || error ? 2 : 1,
            borderRadius: theme.radius.control,
            backgroundColor: disabled ? theme.colors.surfaceSunken : theme.colors.surface,
            minHeight: theme.minTouchTarget,
            paddingHorizontal: theme.space[3],
            columnGap: theme.space[2],
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          secureTextEntry={secure && !revealed}
          keyboardType={keyboardType}
          allowFontScaling={false}
          placeholderTextColor={theme.colors.textDisabled}
          // Composed, not replaced. `ControlledInput` passes React Hook
          // Form's own `onBlur` through, and a spread that overwrote
          // these would leave the focus ring on every field the patient
          // has ever touched.
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          accessibilityLabel={required ? `${label}, required` : label}
          {...(error === undefined ? {} : { 'aria-invalid': true, 'aria-errormessage': error })}
          {...(hint === undefined ? {} : { accessibilityHint: hint })}
          style={[
            styles.input,
            theme.typography.body,
            { color: disabled ? theme.colors.textDisabled : theme.colors.textPrimary },
          ]}
          {...rest}
        />

        {secure ? (
          <Pressable
            onPress={() => setRevealed((current) => !current)}
            hitSlop={12}
            {...pressableA11y({
              // TODO(i18n): no catalogue keys exist for these two labels yet.
              label: revealed ? 'Hide password' : 'Show password',
              disabled,
              selected: revealed,
            })}
          >
            <Icon name={revealed ? 'eyeOff' : 'eye'} size={20} />
          </Pressable>
        ) : null}
      </View>

      {error === undefined ? (
        hint === undefined ? null : (
          <Text variant="caption" color="textTertiary">
            {hint}
          </Text>
        )
      ) : (
        <View style={[styles.errorRow, { columnGap: theme.space[1] }]}>
          <Icon name="alertCircle" size={14} color="error" />
          <Text
            variant="caption"
            color="error"
            accessibilityLiveRegion="polite"
            style={styles.grow}
          >
            {error}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorRow: { alignItems: 'center', flexDirection: 'row' },
  field: { alignItems: 'center', flexDirection: 'row' },
  grow: { flex: 1 },
  input: { flex: 1, paddingVertical: 10 },
});
