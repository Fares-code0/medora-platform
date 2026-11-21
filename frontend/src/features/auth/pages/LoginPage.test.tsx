import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import { LocaleProvider } from '@/i18n';
import { AuthError, UnsupportedRoleError, type AuthErrorCode } from '@/types/auth';

import LoginPage from './LoginPage';

/**
 * FE-10 finding F34. The API refuses a sign-in for reasons a retry cannot
 * fix — a suspended account, a privileged account with no second factor —
 * and for one a retry makes worse — throttling. `api/endpoints/auth.ts`
 * already maps all three to coded `AuthError`s; the page dropped them into
 * "Something went wrong signing you in. Please try again."
 */

const login = vi.fn<ReturnType<typeof Providers.useAuth>['login']>();
const authState = { sessionEnded: false };

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return { ...actual, useAuth: () => ({ login, sessionEnded: authState.sessionEnded }) };
});

async function signInRefusedWith(code: AuthErrorCode) {
  login.mockRejectedValueOnce(new AuthError(code));
  const user = userEvent.setup();
  render(
    <LocaleProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </LocaleProvider>,
  );

  await user.type(screen.getByLabelText('Email address'), 'dr.someone@medora.health');
  await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'Correct-horse-1');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage refusals', () => {
  it.each([
    ['account_inactive', 'This account is not active. Contact your administrator.'],
    [
      'two_factor_required',
      'This account requires two-factor authentication. Contact your administrator.',
    ],
    ['rate_limited', 'Too many sign-in attempts. Wait a few minutes, then try again.'],
    ['invalid_credentials', 'Incorrect email or password. Please try again.'],
  ] as const)('names %s instead of "something went wrong"', async (code, message) => {
    await signInRefusedWith(code);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it('says a role the web app cannot place is the reason, not the password (DEC-013)', async () => {
    login.mockRejectedValueOnce(new UnsupportedRoleError('senior_nurse'));
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </LocaleProvider>,
    );
    await user.type(screen.getByLabelText('Email address'), 'nurse@medora.health');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText(
        "This account's role has no workspace in the Medora web app yet. Ask your administrator to assign a supported role.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Incorrect email or password/)).not.toBeInTheDocument();
  });

  it('sends a patient to the Medora patient mobile app, and establishes no session', async () => {
    login.mockRejectedValueOnce(new UnsupportedRoleError('patient'));
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </LocaleProvider>,
    );
    await user.type(screen.getByLabelText('Email address'), 'patient@medora.health');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/Medora patient mobile app/)).toBeInTheDocument();
    expect(screen.queryByText(/has no workspace in the Medora web app/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Incorrect email or password/)).not.toBeInTheDocument();
    // Still on the sign-in form: the refusal threw, so nothing navigated away.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps the generic unsupported-role message for a nurse', async () => {
    login.mockRejectedValueOnce(new UnsupportedRoleError('nurse'));
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </LocaleProvider>,
    );
    await user.type(screen.getByLabelText('Email address'), 'nurse@medora.health');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText(/has no workspace in the Medora web app yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/patient mobile app/)).not.toBeInTheDocument();
  });

  it('keeps the generic message for a refusal it has no words for', async () => {
    await signInRefusedWith('token_invalid');

    expect(
      await screen.findByText('Something went wrong signing you in. Please try again.'),
    ).toBeInTheDocument();
  });
});

describe('LoginPage after a session the server ended', () => {
  const ENDED = 'Your session has ended. Sign in again to continue.';

  function renderLogin() {
    render(
      <LocaleProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </LocaleProvider>,
    );
  }

  it('says why the sign-in page appeared', () => {
    authState.sessionEnded = true;
    renderLogin();
    expect(screen.getByText(ENDED)).toBeInTheDocument();
    authState.sessionEnded = false;
  });

  it('says nothing on an ordinary visit', () => {
    renderLogin();
    expect(screen.queryByText(ENDED)).not.toBeInTheDocument();
  });

  it('gives way to the refusal of a new attempt', async () => {
    authState.sessionEnded = true;
    await signInRefusedWith('invalid_credentials');

    expect(
      await screen.findByText('Incorrect email or password. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(ENDED)).not.toBeInTheDocument();
    authState.sessionEnded = false;
  });
});
