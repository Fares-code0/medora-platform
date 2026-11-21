import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { LocaleProvider } from '@/i18n';
import { AuthError, ReauthLockoutError, type AuthErrorCode } from '@/types/auth';

import LockScreenPage from './LockScreenPage';

/**
 * Unlocking spends `POST /auth/login` (A-12a), so it fails for every reason a
 * sign-in does — and since M37.2 that includes a 429. The page answered all
 * of them "Incorrect password. Please try again.", which sends a user who
 * typed the right password into more attempts, towards the lockout.
 */

const unlock = vi.fn<(password: string) => Promise<void>>();
const logout = vi.fn<() => Promise<void>>();

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({
      user: { name: 'Amelia Chen', email: 'dr.chen@medora.health', role: 'doctor' },
      unlock,
      logout,
    }),
  };
});

afterEach(() => {
  unlock.mockReset();
  logout.mockReset();
});

async function unlockRefusedWith(error: unknown) {
  unlock.mockRejectedValueOnce(error);
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <LocaleProvider>
        <MemoryRouter>
          <LockScreenPage />
        </MemoryRouter>
      </LocaleProvider>
    </ThemeProvider>,
  );
  await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'Correct-horse-1');
  await user.click(screen.getByRole('button', { name: 'Unlock' }));
}

const INCORRECT = 'Incorrect password. Please try again.';

describe('LockScreenPage refusals', () => {
  it('still says a wrong password is wrong', async () => {
    await unlockRefusedWith(new AuthError('invalid_credentials'));
    expect(await screen.findByText(INCORRECT)).toBeInTheDocument();
  });

  it.each([
    ['rate_limited', 'Too many attempts. Wait a few minutes, then try again.'],
    [
      'otp_required',
      'This account uses two-factor sign-in, which the lock screen cannot complete. Log out, then sign in again.',
    ],
    // Required by policy but never enrolled (backend `cd123ff`): signing in
    // again fails the same way, so "log out and sign in" would be wrong.
    [
      'two_factor_required',
      'This account requires two-factor authentication. Contact your administrator.',
    ],
    ['account_inactive', 'This account is not active. Contact your administrator.'],
  ] as const)(
    'names %s instead of calling the password wrong',
    async (code: AuthErrorCode, message) => {
      await unlockRefusedWith(new AuthError(code));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByText(INCORRECT)).not.toBeInTheDocument();
    },
  );

  it('does not blame the password for a failure that is not an auth refusal', async () => {
    await unlockRefusedWith(new Error('network down'));

    expect(
      await screen.findByText('We could not unlock your session. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(INCORRECT)).not.toBeInTheDocument();
  });
});

describe('LockScreenPage — the lockout ends the session (A-12a)', () => {
  it('stops offering the password field and sends the user to sign in again', async () => {
    logout.mockResolvedValue(undefined);
    await unlockRefusedWith(new ReauthLockoutError());

    expect(
      await screen.findByText(
        'Too many incorrect attempts. For your security, this session has been signed out. Wait a few minutes, then sign in again.',
      ),
    ).toBeInTheDocument();
    // The server revoked the session: there is nothing left to unlock.
    expect(screen.queryByLabelText('Password', { selector: 'input' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('keeps the field for an ordinary throttle, which revoked nothing', async () => {
    await unlockRefusedWith(new AuthError('rate_limited'));

    expect(
      await screen.findByText('Too many attempts. Wait a few minutes, then try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Password', { selector: 'input' })).toBeInTheDocument();
  });
});
