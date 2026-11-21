import { useEffect, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Icon, Screen, Text } from '@/components';
import { useT } from '@/i18n';
import type { AuthStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { FormBanner } from '../components/FormBanner';
import { authService } from '../service';
import { useAuthError } from '../useAuthErrorMessage';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyEmail'>;

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * "Check your email".
 *
 * The address is shown because a typo in it is the single most common
 * reason this screen becomes a dead end, and a patient who can see
 * `sara@gmial.com` fixes it themselves.
 *
 * Resend takes the ADDRESS, not a token — the patient is here having
 * never opened the first message, so an address is all they have. That is
 * the live `POST /auth/verification/resend` contract, not an invention.
 */
export function VerifyEmailScreen({ navigation, route }: Props) {
  const authError = useAuthError();
  const theme = useTheme();
  const t = useT();
  const { email } = route.params;
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    setError(null);
    try {
      await authService.resendVerification(email);
      setNotice(t('auth.verify.resent'));
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (caught) {
      setError(authError(caught));
    }
  };

  return (
    <Screen edges={['top', 'bottom']} testID="verify-email-screen">
      <View
        style={{ alignItems: 'center', rowGap: theme.space[3], paddingVertical: theme.space[6] }}
      >
        <Icon name="inbox" size={44} color="primary" />
        <Text variant="h1" align="center" {...headingA11y(t('auth.verify.title'))}>
          {t('auth.verify.title')}
        </Text>
        <Text variant="body" color="textSecondary" align="center">
          {t('auth.verify.body', { email })}
        </Text>
      </View>

      {error === null ? null : <FormBanner testID="verify-error" message={error} />}
      {notice === null ? null : <FormBanner tone="success" message={notice} />}

      <Button
        label={
          cooldown > 0
            ? t('auth.verify.resendCooldown', { seconds: cooldown })
            : t('auth.verify.resend')
        }
        tone="secondary"
        size="lg"
        fullWidth
        disabled={cooldown > 0}
        testID="verify-resend"
        onPress={() => void resend()}
      />
      <Button
        label={t('auth.action.backToSignIn')}
        tone="ghost"
        onPress={() => navigation.navigate('Login')}
      />
    </Screen>
  );
}
