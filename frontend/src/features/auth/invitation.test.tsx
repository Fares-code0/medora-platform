import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/i18n';
import { routes } from '@/routes';
import { AuthError } from '@/types/auth';

import { invitationService } from './invitation-service';
import { DEMO_INVITATION_TOKEN, mockInvitationService } from './mock/mock-invitation-service';
import AcceptInvitationPage from './pages/AcceptInvitationPage';

/**
 * Administrator invitation acceptance (ADR-035 §5).
 *
 * The property under test is the one the whole flow exists for: **an
 * invited administrator cannot reach an active account without enrolling
 * a second factor.** On this side of the seam that means the page never
 * offers a way past step 2, and the server-side guarantee is proved in
 * `backend/test/auth-admin-invitation.e2e-spec.ts`.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(token = DEMO_INVITATION_TOKEN) {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[`${routes.acceptInvitation}?token=${token}`]}>
        <Routes>
          <Route path={routes.acceptInvitation} element={<AcceptInvitationPage />} />
          <Route path={routes.login} element={<p>sign in page</p>} />
        </Routes>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

/**
 * Types a code across the six cells.
 *
 * One digit per cell rather than one `type` call: `OtpInput` moves focus
 * itself after each keystroke, and each cell is `maxLength={1}`, so a
 * six-character `type` against the first cell delivers one digit and
 * discards five.
 */
async function enterCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  const cells = screen.getAllByRole('textbox');
  for (const [index, digit] of [...code].entries()) {
    await user.type(cells[index]!, digit);
  }
}

async function completePasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Password'), 'Invited123!');
  await user.type(screen.getByLabelText('Confirm password'), 'Invited123!');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('the seam', () => {
  it('resolves to an adapter that implements both phases', () => {
    // Both are declared on the port, so a partial adapter is a compile
    // error — this asserts the selection actually bound something.
    expect(typeof invitationService.accept).toBe('function');
    expect(typeof invitationService.activate).toBe('function');
  });
});

describe('step 1 — setting a password', () => {
  it('refuses a password that fails the policy without calling the server', async () => {
    const accept = vi.spyOn(mockInvitationService, 'accept');
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Password'), 'weak');
    await user.type(screen.getByLabelText('Confirm password'), 'weak');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
  });

  it('refuses a mismatched confirmation', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Password'), 'Invited123!');
    await user.type(screen.getByLabelText('Confirm password'), 'Different123!');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });

  it('shows the MFA requirement before the password is submitted', async () => {
    renderPage();

    // Finding out at step 2 that a second factor is mandatory would be a
    // surprise; ADR-035 §7 makes it a requirement, so the page says so
    // while the user can still back out.
    expect(await screen.findByText(/require two-factor authentication/i)).toBeInTheDocument();
  });

  it('advances to enrolment and never issues a session', async () => {
    const user = userEvent.setup();
    renderPage();

    await completePasswordStep(user);

    expect(await screen.findByText('Setup key')).toBeInTheDocument();
    // No "you are signed in" affordance anywhere — the account is
    // INACTIVE until step 2 completes.
    expect(screen.queryByText('sign in page')).not.toBeInTheDocument();
  });

  it('reports an invalid invitation without advancing', async () => {
    const user = userEvent.setup();
    renderPage('not-a-real-token');

    await completePasswordStep(user);

    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    expect(screen.queryByText('Setup key')).not.toBeInTheDocument();
  });
});

describe('step 2 — enrolling a second factor', () => {
  it('shows the secret and the recovery codes exactly once', async () => {
    const user = userEvent.setup();
    renderPage();
    await completePasswordStep(user);

    expect(await screen.findByText('Setup key')).toBeInTheDocument();
    expect(screen.getByText('Recovery codes')).toBeInTheDocument();
    // Ten, matching the server's count.
    const enrolment = await mockInvitationService.accept(DEMO_INVITATION_TOKEN, 'Invited123!');
    expect(enrolment.recoveryCodes).toHaveLength(10);
    expect(screen.getByText(enrolment.recoveryCodes[0]!)).toBeInTheDocument();
  });

  it('activates on a valid code and sends the user to sign in', async () => {
    const user = userEvent.setup();
    renderPage();
    await completePasswordStep(user);
    await screen.findByText('Setup key');

    await enterCode(user, '123456');

    // Twice — the card heading and the success alert, as
    // `ResetPasswordPage` does it.
    expect(await screen.findAllByText('Your account is active')).not.toHaveLength(0);

    // Still no session: the invitee signs in through /login like every
    // other principal.
    await user.click(screen.getByRole('button', { name: 'Go to sign in' }));
    await waitFor(() => {
      expect(screen.getByText('sign in page')).toBeInTheDocument();
    });
  });

  it('reports a rejected code and stays on the enrolment step', async () => {
    vi.spyOn(mockInvitationService, 'activate').mockRejectedValue(new AuthError('otp_invalid'));
    const user = userEvent.setup();
    renderPage();
    await completePasswordStep(user);
    await screen.findByText('Setup key');

    await enterCode(user, '000000');

    expect(await screen.findByText(/code is not valid/i)).toBeInTheDocument();
    expect(screen.queryByText('Your account is active')).not.toBeInTheDocument();
  });

  it('offers no way to skip enrolment', async () => {
    const user = userEvent.setup();
    renderPage();
    await completePasswordStep(user);
    await screen.findByText('Setup key');

    // The one button on this step activates the account; there is no
    // "later", "skip" or "remind me". That is the point of ADR-035 §7 —
    // an administrator account with no second factor must not be
    // reachable, and the UI must not imply otherwise.
    const buttons = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(buttons).toContain('Activate account');
    for (const label of buttons) {
      expect(label.toLowerCase()).not.toMatch(/skip|later|remind/);
    }
  });
});
