import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { useTheme } from '@/theme';
import type { ColorToken } from '@/theme/tokens';

/**
 * The card.
 *
 * Elevation is a 1px border, not a drop shadow — the decision the web
 * tokens make (`tokens.css` header: "a card reaching for a shadow is a
 * card that wants a border") and the cheapest thing to render on a
 * low-end Android device, which is the performance budget W-08 sets.
 *
 * `tone` tints the surface and the border together. A tinted card that
 * keeps the neutral border reads as a mistake in dark mode, where the
 * neutral border is barely visible against the tint.
 */
export type CardTone = 'default' | 'sunken' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface CardProps {
  readonly children: React.ReactNode;
  readonly tone?: CardTone;
  readonly onPress?: () => void;
  /** Required when `onPress` is set — a tappable card is a control. */
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly padded?: boolean;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

const TONE_TOKENS: Record<CardTone, { surface: ColorToken; border: ColorToken }> = {
  default: { surface: 'surface', border: 'border' },
  sunken: { surface: 'surfaceSunken', border: 'border' },
  primary: { surface: 'primarySubtle', border: 'primary' },
  success: { surface: 'successSubtle', border: 'success' },
  warning: { surface: 'warningSubtle', border: 'warning' },
  error: { surface: 'errorSubtle', border: 'error' },
  info: { surface: 'infoSubtle', border: 'info' },
};

export function Card({
  children,
  tone = 'default',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  padded = true,
  testID,
  style,
}: CardProps) {
  const theme = useTheme();
  const tokens = TONE_TOKENS[tone];

  const base: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor: theme.colors[tokens.surface],
      borderColor: theme.colors[tokens.border],
      borderRadius: theme.radius.surface,
      padding: padded ? theme.space[4] : 0,
      rowGap: theme.space[2],
    },
    style,
  ];

  if (onPress === undefined) {
    return (
      <View testID={testID} style={base}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      {...pressableA11y({
        label: accessibilityLabel ?? '',
        ...(accessibilityHint === undefined ? {} : { hint: accessibilityHint }),
      })}
      style={({ pressed }) => [
        base,
        pressed ? { backgroundColor: theme.colors.surfaceSunken } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden' },
});
