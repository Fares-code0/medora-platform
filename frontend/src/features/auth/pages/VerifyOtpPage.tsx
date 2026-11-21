import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Button, Input } from '@/components/ui';
import { env } from '@/configs/env';
import { useT } from '@/i18n';
import { routes } from '@/routes';
import { isAuthError, UnsupportedRoleError } from '@/types/auth';

import { AuthCard, AuthFormError, Countdown, OtpInput, useCountdown } from '../components';
import { authErrorKey } from '../error-message';
import { OTP_LENGTH } from '../schemas/otp';

const RESEND_SECONDS = 30;

/**
 * The second factor, or one of the account's recovery codes in its place
 * (owner decision R1, `POST /auth/otp/recovery`). Both complete the same
 * pending challenge and spend from the same attempt budget, so a wrong
 * recovery code is named as wrong, a throttle as a throttle, and anything
 * else as a failure to verify, never as a wrong code.
 */
type Mode = 'authenticator' | 'recovery';

/**
 * The challenge's lifetime — backend `OTP_CHALLENGE_TTL_SECONDS` (5 min),
 * restarted by every "more time" (`StepUpService.resend` sets a fresh
 * `expiresAt`).
 *
 * The server answers an expired challenge with the same `401 otp_invalid`
 * as a wrong code — deliberately, so nothing distinguishes them to a
 * guesser. But the page knows when the challenge began, and a refusal after
 * its lifetime cannot be a wrong code worth retyping: every code, right or
 * wrong, now fails. Measured live: a valid code entered at 5 min 20 s was
 * answered "That code is incorrect", inviting retries that could never
 * succeed. Past the window the page says the sign-in expired and offers the
 * way back instead. Nothing the server withholds is revealed — the client
 * is reading its own clock.
 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export default function VerifyOtpPage() {
  const t = useT();
  const { verifyOtp, redeemRecoveryCode, resendOtp } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const { remaining, done, restart } = useCountdown(RESEND_SECONDS);
  const [mode, setMode] = useState<Mode>('authenticator');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [expired, setExpired] = useState(false);
  const challengeStartedAt = useRef(0);
  useEffect(() => {
    challengeStartedAt.current = Date.now();
  }, []);

  /** A refused code past the challenge's lifetime is an expired sign-in. */
  const refusedAsExpired = (error: unknown): boolean => {
    if (!isAuthError(error) || error.code !== 'otp_invalid') return false;
    if (Date.now() - challengeStartedAt.current < CHALLENGE_TTL_MS) return false;
    setExpired(true);
    return true;
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setFormError(null);
    setCode('');
    setRecoveryCode('');
  };

  const submitRecovery = async (event: FormEvent) => {
    event.preventDefault();
    if (recoveryCode.trim() === '' || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await redeemRecoveryCode(recoveryCode);
      navigate(routes.root, { replace: true });
    } catch (error) {
      if (refusedAsExpired(error)) return;
      if (error instanceof UnsupportedRoleError && error.role === 'patient') {
        setFormError(t('login.error.patientRole'));
        setRecoveryCode('');
        return;
      }
      setFormError(
        t(
          authErrorKey(
            error,
            { otp_invalid: 'otp.recovery.error.invalid' },
            'otp.recovery.error.generic',
          ),
        ),
      );
      setRecoveryCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (value: string) => {
    if (value.length !== OTP_LENGTH || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await verifyOtp(value);
      navigate(routes.root, { replace: true });
    } catch (error) {
      if (refusedAsExpired(error)) return;
      if (error instanceof UnsupportedRoleError && error.role === 'patient') {
        setFormError(t('login.error.patientRole'));
        setCode('');
        return;
      }
      setFormError(
        t(authErrorKey(error, { otp_invalid: 'otp.error.invalid' }, 'otp.error.generic')),
      );
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await resendOtp();
      // The server set a fresh expiry; so does the page.
      challengeStartedAt.current = Date.now();
      restart();
    } catch (error) {
      // A real backend rate-limits this (429). Surface it and leave the
      // countdown running; unhandled, it would reject into nothing.
      setFormError(t(authErrorKey(error, {}, 'otp.error.generic')));
    } finally {
      setResending(false);
    }
  };

  if (expired) {
    return (
      <AuthCard title={t('otp.title')}>
        <div className="flex flex-col gap-5">
          <Alert variant="warning" title={t('otp.error.expired')} />
          <Button type="button" fullWidth onClick={() => navigate(routes.login, { replace: true })}>
            {t('common.back')}
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (mode === 'recovery') {
    return (
      <AuthCard title={t('otp.title')} subtitle={t('otp.recovery.subtitle')}>
        <AuthFormError message={formError} />

        <form
          onSubmit={(event) => void submitRecovery(event)}
          noValidate
          className="flex flex-col gap-5"
        >
          <Input
            label={t('otp.recovery.label')}
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            maxLength={64}
            dir="ltr"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            disabled={submitting}
          />
          <Button
            type="submit"
            fullWidth
            loading={submitting}
            disabled={recoveryCode.trim() === ''}
          >
            {t('otp.recovery.submit')}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => switchMode('authenticator')}
          >
            {t('otp.useAuthenticator')}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('otp.title')} subtitle={t('otp.subtitle')}>
      <AuthFormError message={formError} />

      <div className="flex flex-col gap-5">
        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={(value) => void submit(value)}
          length={OTP_LENGTH}
          disabled={submitting}
          invalid={Boolean(formError)}
        />
        {/*
          The demo code is the mock backend's, and only the mock accepts it.
          Shown to a live sign-in it is an instruction that cannot work, on
          the one step where a confused user starts guessing — and every
          wrong guess spends from the challenge's attempt budget.
        */}
        {env.enableMocks ? (
          <p className="text-center text-caption text-text-tertiary">{t('otp.hint')}</p>
        ) : null}

        <Button
          type="button"
          fullWidth
          loading={submitting}
          disabled={code.length !== OTP_LENGTH}
          onClick={() => void submit(code)}
        >
          {t('otp.submit')}
        </Button>

        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={resending}
            disabled={!done}
            onClick={() => void handleResend()}
          >
            {t('otp.resend')}
          </Button>
          {!done ? <Countdown label={t('otp.resendIn')} seconds={remaining} /> : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => switchMode('recovery')}
          >
            {t('otp.useRecoveryCode')}
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
