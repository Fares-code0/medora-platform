import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Pressable, StyleSheet } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { Icon, Text } from '@/components';
import { useTheme } from '@/theme';

/**
 * The persistent Emergency affordance in a stack header.
 *
 * ── Why this is a component and not two copies ──────────────────────
 *
 * It used to be a private function inside `navigation/AppTabs.tsx`,
 * which meant the guarantee it implements — "Emergency is one tap from
 * anywhere" — held on the **signed-in** side only. `AuthStack` set no
 * `headerRight` at all, so a patient part-way through registration, on
 * the OTP screen, on the email-confirmation screen, or resetting a
 * password had no route to Emergency except the back button: back to
 * Welcome, then the card. Two taps and a decision, at the one moment
 * this app promises neither.
 *
 * Those screens are not hypothetical dead ends. `VerifyEmail` and
 * `ResetPassword` are where a patient waits for a message that may take
 * minutes to arrive, and `Otp` is a screen a patient can be stuck on
 * indefinitely if the code never comes.
 *
 * So the button lives here, in the emergency feature that owns it, and
 * both navigators mount the same one.
 *
 * ── The styling rules it carries ────────────────────────────────────
 *
 * Error tone and **always labelled**, never an unlabelled icon: an
 * icon-only emergency control is one a patient has to have learned
 * before the emergency. `hitSlop` widens the target well past the 44pt
 * minimum inside a header that cannot give it more room.
 *
 * ── Why it is not in the message catalogue ──────────────────────────
 *
 * The same decision `WelcomeScreen` documents. Emergency material is
 * clinically reviewed (N-07, W-10), and whether the wording on the way
 * IN is inside that review is the W-10 owner's call rather than a
 * translator's; `docs/A11Y_AUDIT.md` §6 carries it as an open question.
 * `i18n/no-inline-copy.test.ts` exempts this directory for that reason.
 *
 * ── The navigation type ─────────────────────────────────────────────
 *
 * Deliberately the narrowest param list that is true in both stacks:
 * `Emergency` is a route in `AuthStackParamList` **and** in
 * `RootStackParamList` (`navigation/routes.ts` explains why that is not
 * a duplicate to refactor away). Typing this against either one would
 * be a lie in the other navigator.
 */
type EmergencyReachable = { Emergency: undefined };

export function EmergencyHeaderButton() {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp<EmergencyReachable>>();

  return (
    <Pressable
      testID="header-emergency"
      hitSlop={12}
      onPress={() => navigation.navigate('Emergency')}
      {...pressableA11y({
        label: 'Emergency help',
        hint: 'Opens emergency guidance. It does not place a call.',
      })}
      style={[styles.headerButton, { columnGap: theme.space[1] }]}
    >
      <Icon name="alert" size={18} color="error" />
      <Text variant="label" color="error">
        Emergency
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerButton: { alignItems: 'center', flexDirection: 'row' },
});
