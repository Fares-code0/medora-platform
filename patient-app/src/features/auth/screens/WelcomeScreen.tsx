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
 * ── Why the Emergency card is still in English (C-09) ────────────────
 *
 * Everything else on this screen reads the catalogue. The three strings
 * on the Emergency card do not, and that is a decision rather than an
 * omission: `messages/en.ts` excludes emergency copy because it is
 * clinically reviewed material (N-07, W-10), and the label on the way in
 * is what a person in crisis is scanning for. Whether the *affordance*
 * is in scope of that review — as opposed to the guidance behind it — is
 * a question for the W-10 owner, and an unreviewed Arabic label on the
 * emergency entry point is not the kind of thing to decide in a commit.
 * `docs/A11Y_AUDIT.md` §6 carries it as an open question.
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
        accessibilityLabel="Emergency help"
        accessibilityHint="Opens emergency guidance. It does not place a call."
      >
        <View style={[styles.row, { columnGap: theme.space[3] }]}>
          <Icon name="alert" size={24} color="error" />
          <View style={styles.grow}>
            <Text variant="h3" color="error">
              Emergency help
            </Text>
            <Text variant="bodySm" color="textSecondary">
              Available without signing in, and without a connection.
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
