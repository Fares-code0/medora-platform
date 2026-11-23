import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Card, Icon, Screen, Text } from '@/components';
import { useT } from '@/i18n';
import type { AuthStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

/**
 * The first screen.
 *
 * The Emergency entry point is here, above Sign in, and it is the reason
 * this screen has a design constraint rather than just a layout: a person
 * in crisis who has never signed in, or whose session expired, must reach
 * emergency guidance without an account (checklist E-01, N-01).
 *
 * The Emergency card **navigates**; it does not dial. Every dial in this
 * app is behind the two-step confirmation (R-6), and a one-tap dial on
 * the launch screen would be the worst possible place to break that.
 *
 * ── The Emergency card's language (C-09, W-10) ──────────────────────
 *
 * The card was English-only until the W-10 owner approved translating
 * the emergency affordances on 2026-11-23. Its three strings are now
 * `emergency.*` keys. The Arabic is an engineering draft awaiting the
 * named clinical reviewer; the W-10 sign-off is still not given
 * (`docs/A11Y_AUDIT.md` §6, `docs/SIGNOFF.md`).
 *
 * "Medora" is not translated either, for the ordinary reason: it is a
 * name.
 */
export function WelcomeScreen({ navigation }: Props) {
  const theme = useTheme();
  const t = useT();

  return (
    <Screen edges={['top', 'bottom']} testID="welcome-screen">
      <View style={[styles.hero, { rowGap: theme.space[3], paddingVertical: theme.space[8] }]}>
        <Icon name="heart" size={48} color="primary" />
        <Text variant="display" align="center" {...headingA11y('Medora')}>
          Medora
        </Text>
        <Text variant="body" color="textSecondary" align="center">
          {t('auth.welcome.tagline')}
        </Text>
      </View>

      <Card
        tone="error"
        testID="welcome-emergency-card"
        onPress={() => navigation.navigate('Emergency')}
        accessibilityLabel={t('emergency.help')}
        accessibilityHint={t('emergency.entry.hint')}
      >
        <View style={[styles.row, { columnGap: theme.space[3] }]}>
          <Icon name="alert" size={24} color="error" />
          <View style={styles.grow}>
            <Text variant="h3" color="error">
              {t('emergency.help')}
            </Text>
            <Text variant="bodySm" color="textSecondary">
              {t('emergency.entry.welcomeDetail')}
            </Text>
          </View>
          <Icon name="forward" size={20} color="error" />
        </View>
      </Card>

      <View style={{ rowGap: theme.space[2] }}>
        <Button
          label={t('auth.action.signIn')}
          size="lg"
          fullWidth
          testID="welcome-sign-in"
          onPress={() => navigation.navigate('Login')}
        />
        <Button
          label={t('auth.action.createAccount')}
          tone="secondary"
          size="lg"
          fullWidth
          testID="welcome-register"
          onPress={() => navigation.navigate('Register')}
        />
      </View>

      <Text variant="caption" color="textTertiary" align="center">
        {t('auth.welcome.disclaimer')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  hero: { alignItems: 'center' },
  row: { alignItems: 'center', flexDirection: 'row' },
});
