import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';
import type { ColorToken } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * A small status marker.
 *
 * Every badge carries a text label. Colour is never the only carrier
 * (WCAG 1.4.1), which also means a badge is never just a coloured dot —
 * `StatusBadge` builds on this and adds an icon for the tones a patient
 * must not misread.
 */
export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
  readonly icon?: IconName;
  readonly testID?: string;
}

const TONE_TOKENS: Record<BadgeTone, { background: ColorToken; text: ColorToken }> = {
  neutral: { background: 'surfaceSunken', text: 'textSecondary' },
  primary: { background: 'primarySubtle', text: 'primary' },
  success: { background: 'successSubtle', text: 'success' },
  warning: { background: 'warningSubtle', text: 'warning' },
  error: { background: 'errorSubtle', text: 'error' },
  info: { background: 'infoSubtle', text: 'info' },
};

export function Badge({ label, tone = 'neutral', icon, testID }: BadgeProps) {
  const theme = useTheme();
  const tokens = TONE_TOKENS[tone];

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.badge,
        {
          backgroundColor: theme.colors[tokens.background],
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.space[2],
          paddingVertical: theme.space[1],
          columnGap: theme.space[1],
        },
      ]}
    >
      {icon === undefined ? null : <Icon name={icon} size={12} color={tokens.text} />}
      <Text variant="caption" color={tokens.text}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row' },
});
