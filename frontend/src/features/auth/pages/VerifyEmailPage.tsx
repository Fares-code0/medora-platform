import { useEffect, useRef, useState } from 'react';

import { MailCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui';
import { useT } from '@/i18n';
import { routes } from '@/routes';
import { isAuthError } from '@/types/auth';

import { AuthCard, Countdown, useCountdown } from '../components';

type VerifyState = 'idle' | 'verifying' | 'success' | 'error' | 'rateLimited' | 'resendFailed';

/** A throttled request says so; it must not read as a dead link (M37.2's 429). */
const failedState = (error: unknown): VerifyState =>
  isAuthError(error) && error.code === 'rate_limited' ? 'rateLimited' : 'error';

const resendState = (error: unknown): VerifyState =>
  failedState(error) === 'rateLimited' ? 'rateLimited' : 'resendFailed';

const ERROR_TITLE = {
  error: 'verifyEmail.error.token',
  rateLimited: 'common.rateLimited',
  resendFailed: 'verifyEmail.error.resend',
} as const;

const RESEND_SECONDS = 30;

export default function VerifyEmailPage() {
  const t = useT();
  const { verifyEmail, resendVerification } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');

  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'idle');
  const [resending, setResending] = useState(false);
  const { remaining, done, restart } = useCountdown(RESEND_SECONDS);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    verifyEmail(token)
      .then(() => setState('success'))
      .catch((error: unknown) => setState(failedState(error)));
  }, [token, verifyEmail]);

  const handleResend = async () => {
    setResending(true);
    try {
      await resendVerification();
      restart();
    } catch (error) {
      // The live endpoint is rate-limited, and needs an address this page
      // only has when a sign-in or signup led here. Show the error state
      // rather than rejecting into nothing.
      // `token_invalid` is the adapter's "no address to send to" and keeps the
      // link message; any other failure is the send, not the link.
      setState(isAuthError(error) && error.code === 'token_invalid' ? 'error' : resendState(error));
    } finally {
      setResending(false);
    }
  };

  if (state === 'verifying') {
    return (
      <AuthCard title={t('verifyEmail.title')}>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <Spinner />
          <p className="text-body-sm text-text-secondary">{t('verifyEmail.verifying')}</p>
        </div>
      </AuthCard>
    );
  }

  if (state === 'success') {
    return (
      <AuthCard title={t('verifyEmail.successTitle')}>
        <Alert variant="success" title={t('verifyEmail.successTitle')}>
          {t('verifyEmail.successBody')}
        </Alert>
        <div className="mt-6">
          <Button type="button" fullWidth onClick={() => navigate(routes.login)}>
            {t('verifyEmail.successCta')}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('verifyEmail.title')} subtitle={t('verifyEmail.subtitle')}>
      {state === 'error' || state === 'rateLimited' || state === 'resendFailed' ? (
        <div className="mb-4">
          <Alert variant="error" title={t(ERROR_TITLE[state])} />
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-pill bg-primary-subtle">
          <MailCheck aria-hidden="true" className="h-7 w-7 text-primary" strokeWidth={1.75} />
        </span>
        <p className="text-body-sm text-text-secondary">{t('verifyEmail.pending')}</p>

        <Button
          type="button"
          variant="secondary"
          fullWidth
          loading={resending}
          disabled={!done}
          onClick={() => void handleResend()}
        >
          {t('verifyEmail.resend')}
        </Button>
        {!done ? <Countdown label={t('verifyEmail.resendIn')} seconds={remaining} /> : null}
      </div>
    </AuthCard>
  );
}
