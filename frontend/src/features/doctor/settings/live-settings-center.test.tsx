import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi, type StubbedRequest } from '@/test/api-stub';

import { SettingsPage } from './pages/SettingsPage';

/**
 * Settings → Privacy and Integrations in a live build: the page over the
 * HTTP adapter (`GET /me/settings`, `PATCH /me/settings/privacy`, `POST
 * /me/integrations/{id}/disconnect` — RM M22, served on `backend`), with
 * only the network stubbed.
 *
 * What matters is what the screens refuse to claim: a consent the server
 * never sent, a save it did not keep, a Connect button whose only answer is
 * 501, or a "delete my account" no route performs.
 */

vi.mock('./service', async () => {
  const { httpSettingsService } = await import('./http/http-settings-service');
  return { settingsService: httpSettingsService };
});

const toasts: { variant?: string; title: string; description?: string }[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u-live', name: 'Amelia Chen', email: 'doctor@medora.health' } }),
  useDoctorProfile: () => ({ profile: { fullName: 'Amelia Chen' } }),
  useToast: () => ({
    toast: (entry: { variant?: string; title: string; description?: string }) => {
      toasts.push(entry);
    },
  }),
}));

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  toasts.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ACCOUNT_ROUTES = {
  'GET /me/account': () =>
    envelope({
      email: 'doctor@medora.health',
      username: null,
      phone: '+20 100 000 0000',
      passwordUpdatedAt: '2026-10-04T15:52:32.384Z',
      twoFactorEnabled: false,
      emailVerified: true,
    }),
  'GET /me/sessions': () => envelope([]),
  'GET /me/devices': () => envelope([]),
  'GET /me/login-history': () => pageOf([]),
  'GET /me/activity': () => pageOf([]),
};

/** The server's document — data sharing **off**, not the client default, to prove where switches come from. */
function center(updatedAt = '2026-10-20T08:00:00.000Z', connectedGoogle = true) {
  return envelope({
    updatedAt,
    privacy: { dataSharing: false, analytics: true, cookies: true, aiDataUsage: false },
    integrations: [
      {
        id: 'google-calendar',
        connected: connectedGoogle,
        connectedAt: connectedGoogle ? '2026-10-01T09:00:00.000Z' : null,
        account: connectedGoogle ? 'a.chen@gmail.com' : null,
      },
      { id: 'outlook', connected: false, connectedAt: null, account: null },
      { id: 'zoom', connected: false, connectedAt: null, account: null },
      { id: 'teams', connected: false, connectedAt: null, account: null },
    ],
  });
}

function renderSection(section: 'privacy' | 'integrations'): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (ui: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/doctor/settings/${section}`]}>
        <Routes>
          <Route path="/doctor/settings/:section" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(wrap(<SettingsPage />));
}

const sent = (requests: readonly StubbedRequest[], method: string) =>
  requests.filter((request) => request.method === method);

describe('Settings → Privacy over the API', () => {
  it("draws each consent from the server's document", async () => {
    stubApi({ ...ACCOUNT_ROUTES, 'GET /me/settings': () => center() });
    renderSection('privacy');

    const sharing = await screen.findByRole('switch', {
      name: 'Share profile with in-network providers',
    });
    expect(sharing).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Product analytics' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('saves the whole slice with the version it read, and says so only after the server kept it', async () => {
    const { requests } = stubApi({
      ...ACCOUNT_ROUTES,
      'GET /me/settings': () => center(),
      'PATCH /me/settings/privacy': () => center('2026-10-25T10:00:00.000Z'),
    });
    const user = userEvent.setup();
    renderSection('privacy');

    await user.click(
      await screen.findByRole('switch', { name: 'Share profile with in-network providers' }),
    );
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'success', title: 'Privacy preferences saved' }),
      );
    });
    expect(sent(requests, 'PATCH')).toHaveLength(1);
    expect(sent(requests, 'PATCH')[0]?.body).toEqual({
      updatedAt: '2026-10-20T08:00:00.000Z',
      value: { dataSharing: true, analytics: true, cookies: true, aiDataUsage: false },
    });
  });

  it('names a stale save, keeps nothing, and reloads what is stored', async () => {
    let reads = 0;
    stubApi({
      ...ACCOUNT_ROUTES,
      'GET /me/settings': () => {
        reads += 1;
        return center();
      },
      'PATCH /me/settings/privacy': () =>
        json({ message: 'These settings changed since you loaded them.', code: 'conflict' }, 409),
    });
    const user = userEvent.setup();
    renderSection('privacy');

    await user.click(
      await screen.findByRole('switch', { name: 'Share profile with in-network providers' }),
    );
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(toasts).toContainEqual(
        expect.objectContaining({
          variant: 'error',
          title: 'Your privacy settings changed elsewhere',
        }),
      );
    });
    expect(toasts.some((toast) => toast.variant === 'success')).toBe(false);
    await waitFor(() => {
      expect(reads).toBeGreaterThan(1);
    });
    // The stored value is back on screen even though the re-read document
    // equals the one first loaded — the unsaved edit does not linger.
    await waitFor(() => {
      expect(
        screen.getByRole('switch', { name: 'Share profile with in-network providers' }),
      ).toHaveAttribute('aria-checked', 'false');
    });
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('offers no account deletion: no route performs one', async () => {
    stubApi({ ...ACCOUNT_ROUTES, 'GET /me/settings': () => center() });
    renderSection('privacy');

    await screen.findByRole('switch', { name: 'Product analytics' });
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('says "not connected yet" against a server without the Settings Center', async () => {
    stubApi({
      ...ACCOUNT_ROUTES,
      'GET /me/settings': () => json({ message: 'Cannot GET', code: 'not_found' }, 404),
    });
    renderSection('privacy');

    expect(await screen.findByText('Not connected yet')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows a failed load as a failure with Retry, never as default switches', async () => {
    let fail = true;
    stubApi({
      ...ACCOUNT_ROUTES,
      'GET /me/settings': () => (fail ? json({ message: 'boom' }, 500) : center()),
    });
    const user = userEvent.setup();
    renderSection('privacy');

    expect(await screen.findByText("Couldn't load privacy preferences")).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('switch', { name: 'Product analytics' })).toBeInTheDocument();
  });
});

describe('Settings → Integrations over the API', () => {
  it("shows the server's connections and offers no Connect the server would refuse", async () => {
    stubApi({ ...ACCOUNT_ROUTES, 'GET /me/settings': () => center() });
    renderSection('integrations');

    expect(await screen.findByText(/a\.chen@gmail\.com/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Connecting is not available yet')).toHaveLength(3);
  });

  it('disconnects through the server after confirmation, and shows the refetched state', async () => {
    let connected = true;
    const { requests } = stubApi({
      ...ACCOUNT_ROUTES,
      'GET /me/settings': () => center(undefined, connected),
      'POST /me/integrations/google-calendar/disconnect': () => {
        connected = false;
        return center(undefined, false);
      },
    });
    const user = userEvent.setup();
    renderSection('integrations');

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('alertdialog', { name: /Disconnect Google Calendar/ });
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'success', title: 'Disconnected' }),
      );
    });
    expect(sent(requests, 'POST').map((request) => request.path)).toEqual([
      '/me/integrations/google-calendar/disconnect',
    ]);
    await waitFor(() => {
      expect(screen.queryByText(/a\.chen@gmail\.com/)).not.toBeInTheDocument();
    });
  });

  it('names a refused disconnect and leaves the connection shown', async () => {
    stubApi({
      ...ACCOUNT_ROUTES,
      'GET /me/settings': () => center(),
      'POST /me/integrations/google-calendar/disconnect': () => json({ message: 'boom' }, 500),
    });
    const user = userEvent.setup();
    renderSection('integrations');

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('alertdialog', { name: /Disconnect Google Calendar/ });
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'error', title: 'Could not disconnect' }),
      );
    });
    expect(screen.getByText(/a\.chen@gmail\.com/)).toBeInTheDocument();
  });
});
