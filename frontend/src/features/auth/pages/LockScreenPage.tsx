import { useState } from 'react';
import type { FormEvent } from 'react';

import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Avatar, Button, PasswordInput } from '@/components/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useT, type MessageKey } from '@/i18n';
import { ThemeSwitch } from '@/layouts';
import { routes } from '@/routes';
import { ReauthLockoutError, type AuthErrorCode } from '@/types/auth';

import { AuthCard, AuthFormError } from '../components';
import { authErrorKey } from '../error-message';

/**
 * Unlocking is `POST /me/password/verify` (A-12a), which shares sign-in's
 * guess budget; against an API without that route it spends
 * `POST /auth/login`, and fails for the same reasons a sign-in does. Only a
 * wrong password is the user's to fix by retyping it: calling a throttle, a
 * two-factor account or a server error "Incorrect password" sends someone
 * with the right password into more attempts, which is how an account
 * reaches its lockout.
 *
 * The guess that reaches the lockout revokes the session being unlocked
 * (`ReauthLockoutError`). The password field goes with it: there is nothing
 * left to unlock, and the only way on is to sign in again.
 */
const UNLOCK_ERROR_MESSAGE: Partial<Record<AuthErrorCode, MessageKey>> = {
  invalid_credentials: 'lock.error.invalid',
  // An enrolled account is challenged for a code the lock screen has no
  // field for. An account the policy requires 2FA of but that never enrolled
  // is refused outright (backend `cd123ff`), and signing in again fails the
  // same way, so it gets the sign-in page's "contact your administrator".
  otp_required: 'lock.error.twoFactor',
  two_factor_required: 'login.error.twoFactorRequired',
  account_inactive: 'login.error.inactive',
};

export default function LockScreenPage() {
  const t = useT();
  // Not inside AuthLayout — a locked session is authenticated-but-gated, not a
  // guest — so this page names its own tab, from the key it already renders as
  // its heading.
  useDocumentTitle(t('lock.title'));
  const { user, unlock, logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  // No session to lock — send to login.
  if (!user) return <Navigate to={routes.login} replace />;

  const handleUnlock = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await unlock(password);
      navigate(routes.root, { replace: true });
    } catch (error) {
      if (error instanceof ReauthLockoutError) {
        setSignedOut(true);
        setFormError(t('lock.error.lockedOut'));
      } else {
        setFormError(t(authErrorKey(error, UNLOCK_ERROR_MESSAGE, 'lock.error.generic')));
      }
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate(routes.login, { replace: true });
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="absolute end-4 top-4">
        <ThemeSwitch />
      </div>

      <AuthCard title={t('lock.title')} subtitle={t('lock.subtitle')} showLogo={false}>
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Avatar
            name={user.name}
            size="xl"
            roleRing={user.role === 'doctor' ? 'doctor' : 'staff'}
          />
          <div>
            <p className="text-h5 font-semibold text-text-primary">{user.name}</p>
            <p className="text-body-sm text-text-tertiary">{user.email}</p>
          </div>
        </div>

        <AuthFormError message={formError} />

        {signedOut ? (
          <Button type="button" fullWidth onClick={() => void handleLogout()}>
            {t('lock.signInAgain')}
          </Button>
        ) : (
          <>
            <form onSubmit={(e) => void handleUnlock(e)} noValidate className="flex flex-col gap-4">
              <PasswordInput
                label={t('common.password')}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button type="submit" fullWidth loading={submitting} disabled={!password}>
                {t('lock.unlock')}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleLogout()}>
                {t('lock.logout')}
              </Button>
            </div>
          </>
        )}
      </AuthCard>
    </div>
  );
}
