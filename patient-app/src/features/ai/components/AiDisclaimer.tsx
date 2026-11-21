import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * The persistent framing — checklist K-03.
 *
 * ── Every rule in this file is the row's, not a preference ──────────
 *
 * "**Visible in every AI surface at all times. Not a one-time modal.**"
 * So:
 *
 * - **No dismiss control and no collapsed state.** There is no prop that
 *   hides it. A disclaimer with an X is a disclaimer that is gone the
 *   second time a patient opens the screen, which is every time that
 *   matters.
 * - **Outside the scroll view**, at the top of each assistant screen,
 *   the way `EmergencyDisclaimer` sits above `Screen` on the emergency
 *   screen (N-02). Scrolled away is dismissed with extra steps.
 * - **`accessibilityRole="alert"`**, so it is announced when the screen
 *   opens rather than only when somebody walks to it.
 *
 * ── Why warning tone and not error ──────────────────────────────────
 *
 * `error` is reserved in this app for the emergency surfaces and for
 * something that has gone wrong. An assistant that is working normally
 * is neither, and if every card on the screen were red the one red card
 * that means "call an ambulance" would stop being legible as one.
 * `AiSafetyCard` carries the emergency route, in error tone, once.
 *
 * The copy IS in the message catalogue, unlike the emergency guidance.
 * `messages/en.ts` draws that line: this says what Medora is not, which
 * is product and legal copy, rather than telling a patient what to do
 * about a medical emergency.
 */
export function AiDisclaimer() {
  const theme = useTheme();
  const t = useT();
  const body = t('ai.disclaimer.body');

  return (
    <View
      testID="ai-disclaimer"
      accessible
      accessibilityRole="alert"
      accessibilityLabel={body}
      style={[
        styles.banner,
        {
          backgroundColor: theme.colors.warningSubtle,
          borderColor: theme.colors.warning,
          borderRadius: theme.radius.surface,
          padding: theme.space[3],
          columnGap: theme.space[3],
        },
      ]}
    >
      <Icon name="alertCircle" size={20} color="warning" />
      <Text variant="bodySm" color="warning" style={styles.grow}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: 'flex-start', borderWidth: 1, flexDirection: 'row' },
  grow: { flex: 1 },
});
