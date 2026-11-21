import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import type * as Env from '@/configs/env';
import { LocaleProvider } from '@/i18n';
import { AuthError, UnsupportedRoleError } from '@/types/auth';

import type * as Components from '../components';

import VerifyOtpPage from './VerifyOtpPage';

/**
 * Owner decision R1: a pending two-factor sign-in can be completed with one
 * recovery code instead of the six digits (`POST /auth/otp/recovery`). The
 * page offers it as a second mode of the same step, not as a separate page,
 * because it completes the same challenge.
 */

const auth = {
  verifyOtp: vi.fn<(code: string) => Promise<void>>(),
  redeemRecoveryCode: vi.fn<(code: string) => Promise<void>>(),
  resendOtp: vi.fn<() => Promise<void>>(),
};

const mode = vi.hoisted(() => ({ mocks: true }));
const cooldown = vi.hoisted(() => ({ open: false }));

// The "more time" button opens after a 30-second cooldown; one test opens it.
vi.mock('../components', async (importOriginal) => {
  const actual: typeof Components = await importOriginal();
  return {
    ...actual,
    useCountdown: (seconds: number) =>
      cooldown.open
        ? { remaining: 0, done: true, restart: () => undefined }
        : actual.useCountdown(seconds),
  };
});

vi.mock('@/configs/env', async (importOriginal) => {
  const actual: typeof Env = await importOriginal();
  return {
    ...actual,
    env: {
      ...actual.env,
      get enableMocks() {
        return mode.mocks;
      },
    },
  };
});

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return { ...actual, useAuth: () => auth };
});

afterEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  mode.mocks = true;
});

function renderPage() {
  render(
    <LocaleProvider>
      <MemoryRouter initialEntries={['/verify-otp']}>
        <Routes>
          <Route path="/verify-otp" element={<VerifyOtpPage />} />
          <Route path="*" element={<p>Signed in</p>} />
        </Routes>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

async function openRecovery() {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
  return user;
}

describe('VerifyOtpPage — a recovery code in place of the second factor (R1)', () => {
  it('signs in with a recovery code and never sends it as an OTP', async () => {
    auth.redeemRecoveryCode.mockResolvedValue(undefined);
    const user = await openRecovery();

    await user.type(screen.getByLabelText('Recovery code'), '0a1b2-c3d4e');
    await user.click(screen.getByRole('button', { name: 'Verify recovery code' }));

    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    expect(auth.redeemRecoveryCode).toHaveBeenCalledWith('0a1b2-c3d4e');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('points a patient with 2FA to the patient app on a recovery code, with no session', async () => {
    auth.redeemRecoveryCode.mockRejectedValue(new UnsupportedRoleError('patient'));
    const user = await openRecovery();

    await user.type(screen.getByLabelText('Recovery code'), '0a1b2-c3d4e');
    await user.click(screen.getByRole('button', { name: 'Verify recovery code' }));

    expect(await screen.findByText(/Medora patient mobile app/)).toBeInTheDocument();
    expect(screen.queryByText('Signed in')).not.toBeInTheDocument();
  });

  it('points a patient with 2FA to the patient app on the six digits, with no session', async () => {
    auth.verifyOtp.mockRejectedValue(new UnsupportedRoleError('patient'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getAllByRole('textbox')[0] as HTMLElement);
    await user.keyboard('123456');

    expect(await screen.findByText(/Medora patient mobile app/)).toBeInTheDocument();
    expect(screen.queryByText('Signed in')).not.toBeInTheDocument();
  });

  it('keeps the generic message for a nurse refused on the OTP step', async () => {
    auth.redeemRecoveryCode.mockRejectedValue(new UnsupportedRoleError('nurse'));
    const user = await openRecovery();

    await user.type(screen.getByLabelText('Recovery code'), '0a1b2-c3d4e');
    await user.click(screen.getByRole('button', { name: 'Verify recovery code' }));

    await screen.findByRole('alert');
    expect(screen.queryByText(/patient mobile app/)).not.toBeInTheDocument();
  });

  it('names a wrong recovery code and clears the field', async () => {
    auth.redeemRecoveryCode.mockRejectedValue(new AuthError('otp_invalid'));
    const user = await openRecovery();

    await user.type(screen.getByLabelText('Recovery code'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Verify recovery code' }));

    expect(
      await screen.findByText('That recovery code is not valid. Check it and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Recovery code')).toHaveValue('');
  });

  it('names the shared attempt budget as a throttle, not a wrong code', async () => {
    auth.redeemRecoveryCode.mockRejectedValue(new AuthError('rate_limited'));
    const user = await openRecovery();

    await user.type(screen.getByLabelText('Recovery code'), '0a1b2-c3d4e');
    await user.click(screen.getByRole('button', { name: 'Verify recovery code' }));

    expect(
      await screen.findByText('Too many attempts. Wait a few minutes, then try again.'),
    ).toBeInTheDocument();
  });

  it('does not call an unreachable route a wrong code', async () => {
    auth.redeemRecoveryCode.mockRejectedValue({ kind: 'not_found' });
    const user = await openRecovery();

    await user.type(screen.getByLabelText('Recovery code'), '0a1b2-c3d4e');
    await user.click(screen.getByRole('button', { name: 'Verify recovery code' }));

    expect(
      await screen.findByText('We could not verify the recovery code. Please try again.'),
    ).toBeInTheDocument();
  });

  it('cannot submit an empty code, and can go back to the authenticator', async () => {
    const user = await openRecovery();

    expect(screen.getByRole('button', { name: 'Verify recovery code' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Use your authenticator app instead' }));

    expect(screen.queryByLabelText('Recovery code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });
});

describe('VerifyOtpPage — what the live step says', () => {
  it('shows the demo code only on the mock path, which is the only one it works on', () => {
    renderPage();
    expect(screen.getByText('Demo code: 123456')).toBeInTheDocument();
  });

  it('never shows the demo code to a live sign-in', () => {
    mode.mocks = false;
    renderPage();
    expect(screen.queryByText(/Demo code/)).not.toBeInTheDocument();
  });

  it('offers more time, not a code that nobody will send', () => {
    // The factor is an authenticator app: `/auth/otp/resend` extends the
    // challenge window and delivers nothing.
    renderPage();
    expect(screen.queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Need more time?' })).toBeInTheDocument();
  });
});

describe('VerifyOtpPage — a challenge past its five minutes is named as expired', () => {
  const T0 = 1_800_000_000_000;
  const FIVE_MIN = 5 * 60 * 1000;

  afterEach(() => {
    vi.restoreAllMocks();
    cooldown.open = false;
  });

  async function typeCode(user: ReturnType<typeof userEvent.setup>) {
    const cells = screen.getAllByRole('textbox');
    for (const [index, digit] of [...'123456'].entries()) {
      await user.type(cells[index]!, digit);
    }
  }

  it('still calls a refused code wrong inside the window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    auth.verifyOtp.mockRejectedValue(new AuthError('otp_invalid'));
    const user = userEvent.setup();
    renderPage();

    now.mockReturnValue(T0 + FIVE_MIN - 1000);
    await typeCode(user);

    expect(
      await screen.findByText('That code is incorrect. Please try again.'),
    ).toBeInTheDocument();
  });

  it('says the sign-in expired, and offers the way back, after the window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    auth.verifyOtp.mockRejectedValue(new AuthError('otp_invalid'));
    const user = userEvent.setup();
    renderPage();

    now.mockReturnValue(T0 + FIVE_MIN + 1000);
    await typeCode(user);

    expect(
      await screen.findByText('This sign-in has expired. Go back and sign in again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('That code is incorrect. Please try again.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('applies to a recovery code too', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    auth.redeemRecoveryCode.mockRejectedValue(new AuthError('otp_invalid'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));

    now.mockReturnValue(T0 + FIVE_MIN + 1000);
    await user.type(screen.getByLabelText('Recovery code'), '0a1b2-c3d4e');
    await user.click(screen.getByRole('button', { name: 'Verify recovery code' }));

    expect(
      await screen.findByText('This sign-in has expired. Go back and sign in again.'),
    ).toBeInTheDocument();
  });

  it('restarts the window when the server grants more time', async () => {
    cooldown.open = true;
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    auth.resendOtp.mockResolvedValue(undefined);
    auth.verifyOtp.mockRejectedValue(new AuthError('otp_invalid'));
    const user = userEvent.setup();
    renderPage();

    now.mockReturnValue(T0 + 4 * 60 * 1000);
    await user.click(screen.getByRole('button', { name: 'Need more time?' }));
    now.mockReturnValue(T0 + 4 * 60 * 1000 + FIVE_MIN - 1000);
    await typeCode(user);

    expect(
      await screen.findByText('That code is incorrect. Please try again.'),
    ).toBeInTheDocument();
  });

  it('does not treat a throttle as expiry', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    auth.verifyOtp.mockRejectedValue(new AuthError('rate_limited'));
    const user = userEvent.setup();
    renderPage();

    now.mockReturnValue(T0 + FIVE_MIN + 1000);
    await typeCode(user);

    expect(
      await screen.findByText('Too many attempts. Wait a few minutes, then try again.'),
    ).toBeInTheDocument();
  });
});
