import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Card, Screen, Text } from '@/components';
import { ControlledInput } from '@/components/form/ControlledInput';
import { useFieldChain } from '@/components/form/useFieldChain';
import { env } from '@/configs/env';
import { useLocale, useT, type MessageKey } from '@/i18n';
import { formatMinutes } from '@/i18n/duration';
import type { AuthStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { FormBanner } from '../components/FormBanner';
import { DEMO_PATIENT_SESSION } from '../dev/demo-session';
import { FIXTURE_CREDENTIALS } from '../fixtures/fixture-auth-service';
import { sessionLockPolicy } from '../lock-policy';
import type { SessionEndReason } from '../model/types';
import { loginFormSchema, type LoginForm } from '../schemas';
import { useSession } from '../SessionProvider';
import { useAuthError } from '../useAuthErrorMessage';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

/**
 * Sign in.
 *
 * Branches on the machine `code`, not the status (see
 * `useAuthErrorMessage`): `invalid_credentials` shows a credentials
 * error and leaves the session alone, `otp_required` routes to the
 * step-up, `email_unverified` says so.
 *
 * The reason `SessionProvider` carried out of the last session is
 * surfaced here as a banner. Bouncing a patient to a login form with no
 * explanation reads as a crash (checklist D-12), and a background
 * timeout the app imposed on itself reads as one twice over
 * (checklist T-11).
 */

/**
 * Why the patient is looking at this form.
 *
 * `signed-out` is absent on purpose: someone who pressed Sign out does
 * not need to be told they pressed Sign out.
 *
 * The timeout's length is interpolated through `formatMinutes` rather
 * than as a bare number, because "1 minutes" is wrong in English and a
 * numeral in front of a bare noun is wrong in Arabic at almost every
 * value — see `i18n/duration.ts`.
 */
const END_OF_SESSION_NOTICE: Partial<Record<SessionEndReason, MessageKey>> = {
  'session-expired': 'auth.login.notice.sessionExpired',
  locked: 'auth.login.notice.locked',
};

export function LoginScreen({ navigation }: Props) {
  const authError = useAuthError();
  const theme = useTheme();
  const t = useT();
  const { locale } = useLocale();
  const { login, state, adoptSession } = useSession();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit } = useForm<LoginForm>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  const noticeKey =
    state.status === 'unauthenticated' && state.reason !== undefined
      ? (END_OF_SESSION_NOTICE[state.reason] ?? null)
      : null;
  const notice =
    noticeKey === null
      ? null
      : t(noticeKey, { duration: formatMinutes(locale, sessionLockPolicy.reauthenticateAfterMs) });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const outcome = await login({
        email: values.email.trim(),
        password: values.password,
        rememberMe: values.rememberMe,
      });
      if (outcome === 'otp-required') {
        navigation.navigate('Otp');
      }
      // On 'authenticated' the root navigator swaps stacks; there is
      // nothing to navigate to here.
    } catch (error) {
      setSubmitError(authError(error));
    } finally {
      setSubmitting(false);
    }
  });

  const chain = useFieldChain({ length: 2, onSubmit: () => void onSubmit() });

  return (
    <Screen edges={['top', 'bottom']} testID="login-screen">
      <Text variant="h1" {...headingA11y(t('auth.action.signIn'))}>
        {t('auth.action.signIn')}
      </Text>

      {notice !== null && submitError === null ? (
        <FormBanner tone="info" testID="login-session-notice" message={notice} />
      ) : null}

      {submitError === null ? null : <FormBanner testID="login-error" message={submitError} />}

      <View style={{ rowGap: theme.space[4] }}>
        <ControlledInput
          {...chain.field(0)}
          control={control}
          name="email"
          label={t('auth.field.email')}
          testID="login-email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <ControlledInput
          {...chain.field(1)}
          control={control}
          name="password"
          label={t('auth.field.password')}
          testID="login-password"
          secure
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
        />
      </View>

      <Button
        label={t('auth.action.signIn')}
        size="lg"
        fullWidth
        loading={submitting}
        testID="login-submit"
        onPress={() => void onSubmit()}
      />

      <View style={{ rowGap: theme.space[2] }}>
        <Button
          label={t('auth.login.forgotPassword')}
          tone="ghost"
          onPress={() => navigation.navigate('ForgotPassword')}
        />
        <Button
          label={t('auth.action.createAccount')}
          tone="ghost"
          onPress={() => navigation.navigate('Register')}
        />
        {/* Translated since the W-10 owner's 2026-11-23 approval — see
            `WelcomeScreen`'s note on the emergency affordance. */}
        <Button
          label={t('emergency.help')}
          tone="ghost"
          icon="alert"
          testID="login-emergency"
          onPress={() => navigation.navigate('Emergency')}
        />
      </View>

      {/* Development builds only. `__DEV__` is a compile-time constant
          Metro replaces with `false` in a release build, so neither this
          button nor the service wrapper behind it exists there — and the
          demo refresh token is then honoured by nothing. See
          `../dev/demo-session.ts`. It is gated on `__DEV__` rather than
          `env.enableMocks` deliberately: the latter is operator-set and a
          deployment can get it wrong. */}
      {__DEV__ ? (
        <View style={{ rowGap: theme.space[2] }} testID="demo-access">
          <Text variant="label" color="textTertiary">
            Development
          </Text>
          <Button
            label="Continue as Demo Patient"
            tone="secondary"
            fullWidth
            testID="login-demo-patient"
            onPress={() => void adoptSession(DEMO_PATIENT_SESSION)}
          />
          <Text variant="caption" color="textTertiary">
            Local development session for {DEMO_PATIENT_SESSION.identity.email}. Not available in a
            release build.
          </Text>
        </View>
      ) : null}

      {env.enableMocks ? (
        <Card tone="sunken" testID="login-fixture-hint">
          <Text variant="label" color="textTertiary">
            Development build — fixture data
          </Text>
          <Text variant="caption" color="textTertiary">
            {FIXTURE_CREDENTIALS.email} / {FIXTURE_CREDENTIALS.password} · OTP{' '}
            {FIXTURE_CREDENTIALS.otpCode}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
