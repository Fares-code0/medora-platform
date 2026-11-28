import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { AiMode } from '../model/types';

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
 * ── Two texts, because the two assistants differ in what they see ────
 *
 * With no `mode` (the assistant's front door) and for `general`, it says
 * what any assistant here is not: not a doctor, not a diagnosis, not for
 * emergencies. For `personal` it adds what the assistant uses — the
 * patient's appointments, test status and insurance — and what it does
 * NOT see: results and the medical record. Saying so on the screen where
 * the question is typed is what lets the patient judge what to ask.
 *
 * Warning tone and not error: `error` is reserved in this app for the
 * emergency surfaces. `AiSafetyCard` carries the emergency route, in
 * error tone, once.
 */
export function AiDisclaimer({ mode }: { readonly mode?: AiMode }) {
  const theme = useTheme();
  const t = useT();
  const body = t(mode === 'personal' ? 'ai.disclaimer.personal' : 'ai.disclaimer.body');

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
