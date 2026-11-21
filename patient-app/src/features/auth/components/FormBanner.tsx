import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import { useTheme } from '@/theme';
import type { ColorToken } from '@/theme/tokens';

/**
 * A form-level message — the submit failed, or the request succeeded and
 * the next step is elsewhere (check your email).
 *
 * `accessibilityRole="alert"` plus a live region, because a submit error
 * appears without any focus change: a screen-reader user who pressed
 * "Sign in" and got silence has no way to know the form rejected them
 * (checklist S-07).
 */
export type BannerTone = 'error' | 'success' | 'info';

const TONE: Record<
  BannerTone,
  { color: ColorToken; background: ColorToken; icon: 'alertCircle' | 'checkCircle' | 'info' }
> = {
  error: { color: 'error', background: 'errorSubtle', icon: 'alertCircle' },
  success: { color: 'success', background: 'successSubtle', icon: 'checkCircle' },
  info: { color: 'info', background: 'infoSubtle', icon: 'info' },
};

export function FormBanner({
  message,
  tone = 'error',
  testID,
}: {
  message: string;
  tone?: BannerTone;
  testID?: string;
}) {
  const theme = useTheme();
  const tokens = TONE[tone];

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={message}
      style={[
        styles.banner,
        {
          backgroundColor: theme.colors[tokens.background],
          borderColor: theme.colors[tokens.color],
          borderRadius: theme.radius.control,
          padding: theme.space[3],
          columnGap: theme.space[2],
        },
      ]}
    >
      <Icon name={tokens.icon} size={18} color={tokens.color} />
      <Text variant="bodySm" color={tokens.color} style={styles.grow}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: 'flex-start', borderWidth: 1, flexDirection: 'row' },
  grow: { flex: 1 },
});
