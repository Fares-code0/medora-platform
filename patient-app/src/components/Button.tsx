import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { useTheme, type Theme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * The button.
 *
 * ── Tone, and what each one means ────────────────────────────────────
 * `primary`     the one affirmative action on a screen
 * `secondary`   an equal alternative — bordered, not filled
 * `ghost`       a tertiary action; no border, no fill
 * `destructive` cancels, deletes, or is otherwise hard to undo
 * `emergency`   dials. Deliberately a separate tone from `destructive`:
 *               they look similar and mean opposite things, and giving
 *               "cancel this appointment" and "call an ambulance" the
 *               same affordance is how a pocket produces a 999 call.
 *               `EmergencyCallButton` is the only caller.
 *
 * ── Size ─────────────────────────────────────────────────────────────
 * `sm` still clears 44dp. There is no size below the accessibility floor,
 * because "just this once, in a dense row" is how a floor stops being one
 * (checklist S-01).
 *
 * ── Disabled ─────────────────────────────────────────────────────────
 * Disabled is drawn with a *sunken surface plus disabled ink*, not with
 * opacity. Opacity on a dark theme makes a filled button fade toward the
 * page and disappear; the explicit pair is legible in both (§8).
 */

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'emergency';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly fullWidth?: boolean;
  /** Screen-reader only: what happens after the press. */
  readonly hint?: string;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

interface ToneColors {
  readonly background: string;
  readonly border: string;
  readonly label: 'textInverse' | 'textPrimary' | 'primary' | 'error';
}

function toneColors(theme: Theme, tone: ButtonTone, pressed: boolean): ToneColors {
  const { colors } = theme;
  switch (tone) {
    case 'primary':
      return {
        background: pressed ? colors.primaryPressed : colors.primary,
        border: pressed ? colors.primaryPressed : colors.primary,
        label: 'textInverse',
      };
    case 'secondary':
      return {
        background: pressed ? colors.surfaceSunken : colors.surface,
        border: colors.borderStrong,
        label: 'textPrimary',
      };
    case 'ghost':
      return {
        background: pressed ? colors.surfaceSunken : 'transparent',
        border: 'transparent',
        label: 'primary',
      };
    case 'destructive':
      return {
        background: pressed ? colors.errorHover : colors.error,
        border: pressed ? colors.errorHover : colors.error,
        label: 'textInverse',
      };
    case 'emergency':
      return {
        background: pressed ? colors.errorHover : colors.error,
        border: colors.error,
        label: 'textInverse',
      };
  }
}

const SIZES: Record<ButtonSize, { height: number; paddingH: number }> = {
  sm: { height: 44, paddingH: 12 },
  md: { height: 48, paddingH: 16 },
  lg: { height: 56, paddingH: 20 },
};

export function Button({
  label,
  onPress,
  tone = 'primary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  fullWidth = false,
  hint,
  testID,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const dimensions = SIZES[size];
  const inert = disabled || loading;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inert}
      {...pressableA11y({
        label,
        ...(hint === undefined ? {} : { hint }),
        disabled,
        busy: loading,
      })}
      style={({ pressed }) => {
        const tones = toneColors(theme, tone, pressed && !inert);
        return [
          styles.base,
          {
            minHeight: Math.max(dimensions.height, theme.minTouchTarget),
            paddingHorizontal: dimensions.paddingH,
            borderRadius: theme.radius.control,
            backgroundColor: inert ? theme.colors.surfaceSunken : tones.background,
            borderColor: inert ? theme.colors.border : tones.border,
            gap: theme.space[2],
          },
          fullWidth ? styles.fullWidth : null,
          style,
        ];
      }}
    >
      {({ pressed }) => {
        const tones = toneColors(theme, tone, pressed && !inert);
        const labelColor = inert ? 'textDisabled' : tones.label;
        return (
          <View style={styles.content}>
            {loading ? (
              <ActivityIndicator
                size="small"
                color={theme.colors[labelColor]}
                accessibilityElementsHidden
              />
            ) : icon === undefined ? null : (
              <Icon name={icon} size={18} color={labelColor} />
            )}
            <Text variant="button" color={labelColor} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    columnGap: 8,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
});
