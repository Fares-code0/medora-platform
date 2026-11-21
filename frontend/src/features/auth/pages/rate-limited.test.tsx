import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import { LocaleProvider } from '@/i18n';
import { AuthError } from '@/types/auth';

import type * as Components from '../components';
import { mockInvitationService } from '../mock/mock-invitation-service';

import AcceptInvitationPage from './AcceptInvitationPage';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';
import SignupPage from './SignupPage';
import VerifyEmailPage from './VerifyEmailPage';
import VerifyOtpPage from './VerifyOtpPage';

/**
 * Backend M37.2 puts one per-client allowance across the ten public
 * credential routes; past it every one answers `429 rate_limited`, which
 * `api/endpoints/auth.ts` already turns into `AuthError('rate_limited')`.
 * Only the sign-in page named it. The others said "please try again" — the
 * one thing that cannot help inside the window — and email verification
 * called the link dead, inviting a resend that is throttled too.
 */

const RATE_LIMITED = 'Too many attempts. Wait a few minutes, then try again.';

const auth = {
  register: vi.fn(),
  verifyOtp: vi.fn(),
  resendOtp: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
};

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return { ...actual, useAuth: () => auth };
});

// The resend buttons open after a 30-second countdown; start them open.
vi.mock('../components', async (importOriginal) => {
  const actual: typeof Components = await importOriginal();
  return { ...actual, useCountdown: () => ({ remaining: 0, done: true, restart: vi.fn() }) };
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of Object.values(auth)) fn.mockReset();
});

const throttled = () => Promise.reject(new AuthError('rate_limited'));

function renderAt(page: React.ReactElement, entry = '/') {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[entry]}>{page}</MemoryRouter>
    </LocaleProvider>,
  );
}

async function enterCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  const cells = screen.getAllByRole('textbox');
  for (const [index, digit] of [...code].entries()) {
    await user.type(cells[index]!, digit);
  }
}

describe('a throttled credential request says so', () => {
  it('signup', async () => {
    auth.register.mockImplementation(throttled);
    const user = userEvent.setup();
    renderAt(<SignupPage />);

    await user.type(screen.getByLabelText('First name'), 'Lina');
    await user.type(screen.getByLabelText('Last name'), 'Haddad');
    await user.type(screen.getByLabelText('Email address'), 'lina@hospital.org');
    await user.type(screen.getByLabelText('Phone number'), '+20 100 214 3387');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'Correct-horse-1');
    await user.type(
      screen.getByLabelText('Confirm password', { selector: 'input' }),
      'Correct-horse-1',
    );
    await user.type(screen.getByLabelText('Professional registration number'), 'EG-44120');
    await user.type(screen.getByLabelText('Specialty'), 'Cardiology');
    await user.click(screen.getByLabelText('I agree to the Terms & Conditions'));
    await user.click(screen.getByLabelText('I have read the Privacy Policy'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
    expect(auth.register).toHaveBeenCalledOnce();
  });

  it('sign-in code: verifying', async () => {
    auth.verifyOtp.mockImplementation(throttled);
    const user = userEvent.setup();
    renderAt(<VerifyOtpPage />);

    await enterCode(user, '123456');

    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
    expect(screen.queryByText(/could not verify the code/)).not.toBeInTheDocument();
  });

  it('sign-in code: resending', async () => {
    auth.resendOtp.mockImplementation(throttled);
    const user = userEvent.setup();
    renderAt(<VerifyOtpPage />);

    await user.click(screen.getByRole('button', { name: 'Need more time?' }));

    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
  });

  it('forgot password', async () => {
    auth.forgotPassword.mockImplementation(throttled);
    const user = userEvent.setup();
    renderAt(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Email address'), 'lina@hospital.org');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
  });

  it('reset password', async () => {
    auth.resetPassword.mockImplementation(throttled);
    const user = userEvent.setup();
    renderAt(<ResetPasswordPage />, '/reset-password?token=abc');

    await user.type(
      screen.getByLabelText('New password', { selector: 'input' }),
      'Correct-horse-1',
    );
    await user.type(
      screen.getByLabelText('Confirm password', { selector: 'input' }),
      'Correct-horse-1',
    );
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
    expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument();
  });

  it('email verification link: not called dead', async () => {
    auth.verifyEmail.mockImplementation(throttled);
    renderAt(<VerifyEmailPage />, '/verify-email?token=abc');

    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
    expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument();
  });

  it('email verification link: a dead link still says so', async () => {
    auth.verifyEmail.mockRejectedValue(new AuthError('token_invalid'));
    renderAt(<VerifyEmailPage />, '/verify-email?token=abc');

    expect(
      await screen.findByText('This verification link is invalid or has expired.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(RATE_LIMITED)).not.toBeInTheDocument();
  });

  it('email verification: resending', async () => {
    auth.resendVerification.mockImplementation(throttled);
    const user = userEvent.setup();
    renderAt(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: 'Resend email' }));

    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
    expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument();
  });

  it('email verification: a failed send is not called a dead link', async () => {
    auth.resendVerification.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderAt(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: 'Resend email' }));

    expect(
      await screen.findByText('We could not send a new verification email. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument();
  });

  it('email verification: no address to send to still reads as the link', async () => {
    auth.resendVerification.mockRejectedValue(new AuthError('token_invalid'));
    const user = userEvent.setup();
    renderAt(<VerifyEmailPage />);

    await user.click(screen.getByRole('button', { name: 'Resend email' }));

    expect(
      await screen.findByText('This verification link is invalid or has expired.'),
    ).toBeInTheDocument();
  });

  it('invitation: setting a password', async () => {
    vi.spyOn(mockInvitationService, 'accept').mockImplementation(throttled);
    const user = userEvent.setup();
    renderAt(<AcceptInvitationPage />, '/accept-invitation?token=abc');

    await user.type(screen.getByLabelText('Password'), 'Invited123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Invited123!');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
    expect(screen.queryByText('Setup key')).not.toBeInTheDocument();
  });
});
