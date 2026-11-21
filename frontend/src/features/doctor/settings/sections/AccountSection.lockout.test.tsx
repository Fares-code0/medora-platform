import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_SETTINGS } from '../model/mock-data';
import { CurrentPasswordError } from '../model/settings-service';
import { settingsService } from '../service';

import { AccountSection } from './AccountSection';

/**
 * Changing the password when the sign-in guess budget runs out (owner
 * decision D1). The server answers 429 and has already ended this session,
 * so the form must say the account is locked and the user is signed out —
 * and sign out here — rather than "Please try again".
 */

const providers = vi.hoisted(() => ({ logout: vi.fn(), toast: vi.fn() }));

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'Amelia Chen' }, logout: providers.logout }),
  useToast: () => ({ toast: providers.toast }),
}));

function renderSection() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccountSection document={SEED_SETTINGS} />
    </QueryClientProvider>,
  );
}

async function submitPasswordChange() {
  await userEvent.type(screen.getByLabelText('Current password'), 'not the password');
  await userEvent.type(screen.getByLabelText('New password'), 'An0ther-Strong-Passphrase!');
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'An0ther-Strong-Passphrase!');
  await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
}

beforeEach(() => {
  providers.logout.mockReset();
  providers.toast.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('change password — the lockout response', () => {
  it('says the account is locked and the session ended, and signs out', async () => {
    vi.spyOn(settingsService, 'changePassword').mockRejectedValue(
      Object.assign(new Error('API error: rate_limited'), {
        kind: 'rate_limited',
        code: 'rate_limited',
        retryAfterSeconds: 900,
      }),
    );
    renderSection();

    await submitPasswordChange();

    await waitFor(() => expect(providers.logout).toHaveBeenCalledTimes(1));
    expect(providers.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        title: 'Too many incorrect passwords',
        description: expect.stringMatching(/temporarily locked.*signed out/) as unknown,
      }),
    );
    // Not the generic "try again" that implied the session was still usable.
    expect(providers.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Please try again.' }),
    );
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('ends the session once, even if the form is sent again while signing out', async () => {
    // Sign-out still in flight: the form is mounted and can be submitted again.
    providers.logout.mockReturnValue(new Promise<void>(() => undefined));
    const change = vi.spyOn(settingsService, 'changePassword').mockRejectedValue(
      Object.assign(new Error('API error: rate_limited'), {
        kind: 'rate_limited',
        code: 'rate_limited',
        retryAfterSeconds: 900,
      }),
    );
    renderSection();

    await submitPasswordChange();
    await waitFor(() => expect(providers.logout).toHaveBeenCalledTimes(1));
    await submitPasswordChange();

    expect(change).toHaveBeenCalledTimes(1);
    expect(providers.logout).toHaveBeenCalledTimes(1);
  });

  it('a 429 without the server’s code is not the lockout: generic message, no sign-out', async () => {
    // What `ApiClient` makes of a proxy's or an edge firewall's 429: the
    // status, and no envelope code.
    vi.spyOn(settingsService, 'changePassword').mockRejectedValue(
      Object.assign(new Error('API error: rate_limited'), {
        kind: 'rate_limited',
        retryAfterSeconds: 30,
      }),
    );
    renderSection();

    await submitPasswordChange();

    await waitFor(() =>
      expect(providers.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not change password' }),
      ),
    );
    expect(providers.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Too many incorrect passwords' }),
    );
    expect(providers.logout).not.toHaveBeenCalled();
  });

  it('a wrong password below the limit stays a field error and keeps the session', async () => {
    vi.spyOn(settingsService, 'changePassword').mockRejectedValue(new CurrentPasswordError());
    renderSection();

    await submitPasswordChange();

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(providers.logout).not.toHaveBeenCalled();
  });

  it('any other failure is still the generic retry message, without signing out', async () => {
    vi.spyOn(settingsService, 'changePassword').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server', ref: 'ref-1' }),
    );
    renderSection();

    await submitPasswordChange();

    await waitFor(() =>
      expect(providers.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not change password' }),
      ),
    );
    expect(providers.logout).not.toHaveBeenCalled();
  });
});
