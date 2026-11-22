import { Pressable, StyleSheet } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { useTheme } from '@/theme';

import { Text } from './Text';

/**
 * A selectable filter chip.
 *
 * Selection is carried by **fill, border AND the accessibility selected
 * state** — three carriers, so it survives a colour-vision deficiency and
 * a screen reader. A chip that changes only its background is a filter a
 * VoiceOver user cannot tell is active.
 *
 * `hitSlop` rather than a taller box: a row of 32dp chips reads correctly
 * and still clears the 44dp touch floor (S-01).
 */
export interface ChipProps {
  readonly label: string;
  /**
   * What assistive technology says, when that must differ from what the
   * chip shows. The language switcher is the case it exists for: the
   * visible label is the endonym — "العربية" — because that is what a
   * speaker scans a list for, while a screen reader running in English
   * should say "Arabic". Defaults to `label`, so a chip that does not
   * need the distinction cannot accidentally lose its label.
   */
  readonly accessibilityLabel?: string;
  readonly selected?: boolean;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export function Chip({
  label,
  accessibilityLabel,
  selected = false,
  onPress,
  disabled = false,
  testID,
}: ChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      {...pressableA11y({ label: accessibilityLabel ?? label, selected, disabled, role: 'button' })}
      style={({ pressed }) => [
        styles.chip,
        {
          minHeight: 32,
          // Width floor for a one- or two-character label; height comes
          // from the vertical hitSlop (32 + 2x8 = 48).
          minWidth: 44,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.space[3],
          borderColor: disabled
            ? theme.colors.border
            : selected
              ? theme.colors.primary
              : theme.colors.borderStrong,
          backgroundColor: disabled
            ? theme.colors.surfaceSunken
            : selected
              ? theme.colors.primarySubtle
              : pressed
                ? theme.colors.surfaceSunken
                : theme.colors.surface,
        },
      ]}
    >
      <Text
        variant="bodySm"
        color={disabled ? 'textDisabled' : selected ? 'primary' : 'textSecondary'}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
  },
});
