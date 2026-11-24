import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Pressable, StyleSheet } from 'react-native';

import { pressableA11y } from '@/accessibility/a11y';
import { Icon, Text } from '@/components';
import { useT } from '@/i18n';
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
 * ── Language ────────────────────────────────────────────────────────
 *
 * The W-10 owner approved translating the emergency affordances on
 * 2026-11-23, so the label and hint are `emergency.*` catalogue keys.
 * The Arabic is an engineering draft awaiting the named clinical
 * reviewer (`docs/SIGNOFF.md`); the W-10 sign-off itself is not given.
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
  const t = useT();
  const navigation = useNavigation<NavigationProp<EmergencyReachable>>();

  return (
    <Pressable
      testID="header-emergency"
      hitSlop={12}
      onPress={() => navigation.navigate('Emergency')}
      {...pressableA11y({
        label: t('emergency.help'),
        hint: t('emergency.entry.hint'),
      })}
      style={[styles.headerButton, { columnGap: theme.space[1] }]}
    >
      <Icon name="alert" size={18} color="error" />
      <Text variant="label" color="error">
        {t('emergency.short')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerButton: { alignItems: 'center', flexDirection: 'row' },
});
