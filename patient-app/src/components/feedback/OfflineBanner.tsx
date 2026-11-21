import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { useNetworkStatus } from '@/network/NetworkProvider';
import { useTheme } from '@/theme';

import { Icon } from '../Icon';
import { Text } from '../Text';

/**
 * The offline banner.
 *
 * Sits under the header on every authenticated screen. It is a banner and
 * not a modal because being offline does not stop a patient reading what
 * is already on screen — and on the Emergency screen it stops nothing at
 * all, since that content is bundled.
 *
 * The copy names the consequence rather than the state: "you can read but
 * not change" is what a patient needs to know, because writes refuse
 * while offline rather than queueing (audit §12.4).
 */
export function OfflineBanner() {
  const theme = useTheme();
  const t = useT();
  const { isOnline, isUnknown } = useNetworkStatus();

  // Nothing during the first probe: a banner that flashes on every cold
  // start trains people to ignore it.
  if (isOnline || isUnknown) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          backgroundColor: theme.colors.warningSubtle,
          borderBottomColor: theme.colors.warning,
          paddingHorizontal: theme.screenGutter,
          paddingVertical: theme.space[2],
          columnGap: theme.space[2],
        },
      ]}
    >
      <Icon name="wifiOff" size={16} color="warning" />
      <Text variant="caption" color="warning" style={styles.grow}>
        {t('state.offline.banner')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row' },
  grow: { flex: 1 },
});
