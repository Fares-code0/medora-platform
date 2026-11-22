import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import { useTheme } from '@/theme';

import { EMERGENCY_DISCLAIMER } from '../content/guidance';

/**
 * The disclaimer.
 *
 * Deliberately has **no dismiss control and no collapsed state**
 * (checklist N-02). It sits above the scroll view, not inside it, so it
 * cannot be scrolled away — a one-time modal is a disclaimer the patient
 * has already dismissed by the time they need it.
 *
 * `accessibilityRole="alert"` so it is announced when the screen opens
 * rather than being reached only by walking to it.
 */
export function EmergencyDisclaimer() {
  const theme = useTheme();

  return (
    <View
      testID="emergency-disclaimer"
      accessible
      accessibilityRole="alert"
      accessibilityLabel={EMERGENCY_DISCLAIMER}
      style={[
        styles.banner,
        {
          backgroundColor: theme.colors.errorSubtle,
          borderColor: theme.colors.error,
          borderRadius: theme.radius.surface,
          padding: theme.space[3],
          columnGap: theme.space[3],
        },
      ]}
    >
      <Icon name="alert" size={22} color="error" />
      <Text critical variant="bodySm" color="error" style={styles.grow}>
        {EMERGENCY_DISCLAIMER}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: 'flex-start', borderWidth: 1, flexDirection: 'row' },
  grow: { flex: 1 },
});
