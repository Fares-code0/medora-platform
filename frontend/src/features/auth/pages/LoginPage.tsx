import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Button, Checkbox, Input, PasswordInput } from '@/components/ui';
import { env } from '@/configs/env';
import { useT, type MessageKey } from '@/i18n';
import { routes } from '@/routes';
import { isAuthError, UnsupportedRoleError, type AuthErrorCode } from '@/types/auth';

import { AuthCard, AuthFormError } from '../components';
import { DemoAccessPanel } from '../dev/DemoAccessPanel';
import { authErrorKey } from '../error-message';
import { demoAccounts, MOCK_PASSWORD } from '../mock/users';
import { loginSchema, type LoginValues } from '../schemas/login';

import { resolveDestination } from './resolveDestination';

/**
 * The sign-in refusals with a message of their own (FE-10 finding F34).
 * `email_unverified` and `otp_required` are not here: they navigate to the
 * step that resolves them. Anything else is the generic message.
 */
const LOGIN_ERROR_MESSAGE: Partial<Record<AuthErrorCode, MessageKey>> = {
  invalid_credentials: 'login.error.invalid',
  account_inactive: 'login.error.inactive',
  two_factor_required: 'login.error.twoFactorRequired',
  rate_limited: 'login.error.rateLimited',
};

export default function LoginPage() {
  const t = useT();
  const { login, sessionEnded } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  // The seeded credentials only exist behind the mock adapter — against a
  // real backend the hint advertises accounts that do not exist.
  const [hintOpen, setHintOpen] = useState(env.enableMocks);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      // The destination follows the role of the session that was actually
      // established. It used to be looked up in the mock's seed list,
      // which returns nothing for any real account.
      const signedIn = await login(values.email, values.password, {
        rememberMe: values.rememberMe,
      });
      navigate(resolveDestination(params.get('returnTo'), signedIn?.role), { replace: true });
    } catch (error) {
      // Before the coded refusals: it is an `AuthError` too, and its code
      // would otherwise read as a wrong password (DEC-013).
      if (error instanceof UnsupportedRoleError) {
        setFormError(
          t(error.role === 'patient' ? 'login.error.patientRole' : 'login.error.unsupportedRole'),
        );
        return;
      }
      if (isAuthError(error)) {
        if (error.code === 'email_unverified') {
          navigate(routes.verifyEmail);
          return;
        }
        if (error.code === 'otp_required') {
          navigate(routes.verifyOtp);
          return;
        }
      }
      // A suspended clinician, a privileged account without its second
      // factor, and a throttled form each need to be told which one it
      // is: "something went wrong, try again" sends the first two back
      // to retry what will never work and the third into a longer lockout.
      setFormError(t(authErrorKey(error, LOGIN_ERROR_MESSAGE, 'login.error.generic')));
    }
  });

  return (
    <AuthCard
      surface="card"
      title={t('login.title')}
      subtitle={t('login.subtitle')}
      footer={
        <p className="text-center text-body-sm text-text-secondary">
          {t('login.noAccount')}{' '}
          <Link to={routes.signup} className="font-semibold text-primary hover:underline">
            {t('login.signupLink')}
          </Link>
        </p>
      }
    >
      {/* The constant compiles this branch, and the mock accounts it lists,
          out of a production build (RM M40.4, scripts/mock-boundary.ts);
          `hintOpen` alone is runtime state the bundler cannot fold. */}
      {import.meta.env.MEDORA_MOCKS_STRIPPED !== true && hintOpen ? (
        <div className="mb-5">
          <Alert variant="info" title={t('login.demoTitle')} onDismiss={() => setHintOpen(false)}>
            <p className="mb-1">{t('login.demoBody')}</p>
            {/* Latin-only credentials; see `AuthFooter` for why `dir` is
                pinned rather than inherited. */}
            <ul dir="ltr" className="font-mono text-caption">
              {demoAccounts.map((a) => (
                <li key={a.email} className="mb-1 last:mb-0">
                  {a.label}: {a.email}
                  {/* Only the two accounts whose sign-in is deliberately
                      suspended carry a note. `font-sans` because it is
                      prose inside a monospaced list of addresses. */}
                  {a.note === undefined ? null : (
                    <span className="block font-sans text-text-secondary">{a.note}</span>
                  )}
                </li>
              ))}
              <li>Password: {MOCK_PASSWORD}</li>
            </ul>
          </Alert>
        </div>
      ) : null}

      {sessionEnded && formError === null ? (
        <div className="mb-4">
          <Alert variant="info" title={t('login.sessionEnded')} />
        </div>
      ) : null}

      <AuthFormError message={formError} />

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        <Input
          size="lg"
          label={t('common.email')}
          type="email"
          autoComplete="email"
          autoFocus
          leadingIcon={Mail}
          placeholder={t('common.emailPlaceholder')}
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordInput
          size="lg"
          label={t('common.password')}
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex items-center justify-between gap-3">
          <Checkbox label={t('login.remember')} {...register('rememberMe')} />
          <Link
            to={routes.forgotPassword}
            className="touch-target text-body-sm font-medium text-primary [--touch-y:13px] hover:underline"
          >
            {t('login.forgot')}
          </Link>
        </div>
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {t('login.submit')}
        </Button>
      </form>

      {/* Development only. `import.meta.env.DEV` is `false` in every build
          Vite produces, so this branch and the module behind it are gone
          from a production bundle — see `dev/DemoAccessPanel.tsx`. */}
      {import.meta.env.DEV ? (
        <DemoAccessPanel
          onSignedIn={(user) =>
            navigate(resolveDestination(params.get('returnTo'), user.role), { replace: true })
          }
        />
      ) : null}
    </AuthCard>
  );
}
