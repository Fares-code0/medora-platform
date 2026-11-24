import { useEffect, useRef, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Input, Screen, Text } from '@/components';
import { useFieldChain } from '@/components/form/useFieldChain';
import { translateValidation, useT } from '@/i18n';
import type { AuthStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';
import { isApiError } from '@/types/api';

import { FormBanner } from '../components/FormBanner';
import { otpFormSchema } from '../schemas';
import { useSession } from '../SessionProvider';
import { useAuthError } from '../useAuthErrorMessage';

type Props = NativeStackScreenProps<AuthStackParamList, 'Otp'>;

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * The challenge's lifetime — backend `OTP_CHALLENGE_TTL_SECONDS` (5 min),
 * restarted by every "more time" (`StepUpService.resend` sets a fresh
 * expiry). The server answers an expired challenge with the same
 * `401 otp_invalid` as a wrong code, deliberately; but this screen knows
 * when the challenge began, and past its lifetime every code — right or
 * wrong — fails. Measured on the web client against a live API: a valid code
 * at 5 min 20 s was called incorrect. Past the window the screen says the
 * sign-in expired and offers the way back, reading only its own clock.
 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * The OTP step-up.
 *
 * The resend countdown is a client-side courtesy, not a rate limit — the
 * server holds the real one and answers `429` with `Retry-After` if the
 * patient gets past this. A client-side timer presented as the rule would
 * be a fake security control (checklist T-07).
 *
 * A single 6-digit field rather than six boxes: six boxes are a
 * screen-reader hazard (six unlabelled inputs), they fight autofill of
 * the SMS code, and they gain nothing a patient notices.
 */
export function OtpScreen({ navigation }: Props) {
  const authError = useAuthError();
  const theme = useTheme();
  const t = useT();
  const { completeOtp, completeWithRecoveryCode, resendOtp, pendingOtpToken } = useSession();
  // The six digits, or one recovery code in their place (owner decision
  // R1). Same pending challenge and attempt budget either way.
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [expired, setExpired] = useState(false);
  const challengeStartedAt = useRef(0);
  useEffect(() => {
    challengeStartedAt.current = Date.now();
  }, []);

  /** A refused code past the challenge's lifetime is an expired sign-in. */
  const refusedAsExpired = (caught: unknown): boolean => {
    if (!isApiError(caught) || caught.code !== 'otp_invalid') return false;
    if (Date.now() - challengeStartedAt.current < CHALLENGE_TTL_MS) return false;
    setExpired(true);
    return true;
  };

  // A direct navigation here with no step-up outstanding (a deep link, a
  // back-stack restore) has nothing to verify.
  useEffect(() => {
    if (pendingOtpToken === null) navigation.replace('Login');
  }, [navigation, pendingOtpToken]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async () => {
    const parsed = otpFormSchema.safeParse({ code });
    if (!parsed.success) {
      // The schema's own message, rendered through its `validation.*`
      // key: Zod schemas are module-level and cannot read a hook.
      const issue = parsed.error.issues[0]?.message;
      setError(issue === undefined ? t('auth.otp.body') : translateValidation(t, issue));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await completeOtp(parsed.data.code);
    } catch (caught) {
      if (refusedAsExpired(caught)) return;
      setError(authError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const submitRecovery = async () => {
    if (recoveryCode.trim() === '') {
      setError(t('auth.otp.recoveryRequired'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await completeWithRecoveryCode(recoveryCode);
    } catch (caught) {
      if (refusedAsExpired(caught)) return;
      // A wrong recovery code is not "a code we sent you" — say which.
      setError(
        isApiError(caught) && caught.code === 'otp_invalid'
          ? t('auth.otp.recoveryInvalid')
          : authError(caught),
      );
      setRecoveryCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: boolean) => {
    setUseRecovery(next);
    setError(null);
    setNotice(null);
    setCode('');
    setRecoveryCode('');
  };

  const resend = async () => {
    setError(null);
    try {
      await resendOtp();
      // The server set a fresh expiry; so does the screen.
      challengeStartedAt.current = Date.now();
      setNotice(t('auth.otp.resent'));
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (caught) {
      setError(authError(caught));
    }
  };

  // One field, so Done submits it — a six-digit code should not need a
  // second reach for the button.
  const chain = useFieldChain({ length: 1, onSubmit: () => void submit() });
  const recoveryChain = useFieldChain({ length: 1, onSubmit: () => void submitRecovery() });

  if (expired) {
    return (
      <Screen edges={['top', 'bottom']} testID="otp-screen">
        <Text variant="h1" {...headingA11y(t('auth.otp.title'))}>
          {t('auth.otp.title')}
        </Text>
        <FormBanner testID="otp-expired" message={t('auth.otp.expired')} />
        <Button
          label={t('auth.action.backToSignIn')}
          size="lg"
          fullWidth
          testID="otp-back-to-sign-in"
          onPress={() => navigation.replace('Login')}
        />
      </Screen>
    );
  }

  if (useRecovery) {
    return (
      <Screen edges={['top', 'bottom']} testID="otp-screen">
        <Text variant="h1" {...headingA11y(t('auth.otp.title'))}>
          {t('auth.otp.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('auth.otp.recoveryBody')}
        </Text>

        {error === null ? null : <FormBanner testID="otp-error" message={error} />}

        <Input
          {...recoveryChain.field(0)}
          label={t('auth.otp.recoveryField')}
          testID="otp-recovery-code"
          value={recoveryCode}
          onChangeText={setRecoveryCode}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={64}
          required
        />

        <View style={{ rowGap: theme.space[2] }}>
          <Button
            label={t('auth.otp.recoverySubmit')}
            size="lg"
            fullWidth
            loading={submitting}
            testID="otp-recovery-submit"
            onPress={() => void submitRecovery()}
          />
          <Button
            label={t('auth.otp.useAuthenticator')}
            tone="ghost"
            disabled={submitting}
            testID="otp-use-authenticator"
            onPress={() => switchMode(false)}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']} testID="otp-screen">
      <Text variant="h1" {...headingA11y(t('auth.otp.title'))}>
        {t('auth.otp.title')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('auth.otp.body')}
      </Text>

      {error === null ? null : <FormBanner testID="otp-error" message={error} />}
      {notice === null ? null : <FormBanner tone="success" message={notice} />}

      <Input
        {...chain.field(0)}
        label={t('auth.otp.field')}
        testID="otp-code"
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        required
      />

      <View style={{ rowGap: theme.space[2] }}>
        <Button
          label={t('auth.otp.submit')}
          size="lg"
          fullWidth
          loading={submitting}
          testID="otp-submit"
          onPress={() => void submit()}
        />
        <Button
          label={
            cooldown > 0
              ? t('auth.otp.resendCooldown', { seconds: cooldown })
              : t('auth.otp.resend')
          }
          tone="ghost"
          disabled={cooldown > 0}
          testID="otp-resend"
          onPress={() => void resend()}
        />
        <Button
          label={t('auth.otp.useRecovery')}
          tone="ghost"
          disabled={submitting}
          testID="otp-use-recovery"
          onPress={() => switchMode(true)}
        />
      </View>
    </Screen>
  );
}
