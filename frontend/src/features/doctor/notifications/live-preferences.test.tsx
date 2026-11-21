import { useState, type ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';

import { NotificationsSection } from '../settings/sections/NotificationsSection';

import { NotificationPreferencesDrawer } from './components/NotificationPreferencesDrawer';
import type * as Capabilities from './model/capabilities';

/**
 * Notification preferences in a live build: the screens over the HTTP
 * adapter (`GET`/`PUT /me/notification-preferences`, API §10.5 — served on
 * `backend`, RM M19.4), with only the network stubbed.
 *
 * What matters is what the screens refuse to claim: a switch drawn from
 * defaults the server never sent, a change the server did not keep, or a
 * load failure shown as a set of switches.
 */

vi.mock('./model/capabilities', async (importOriginal) => {
  const actual: typeof Capabilities = await importOriginal();
  return { ...actual, notificationCapabilities: actual.HTTP_NOTIFICATION_CAPABILITIES };
});

vi.mock('./service', async () => {
  const { httpNotificationService } = await import('./http/http-notification-service');
  return { notificationService: httpNotificationService };
});

const toasts: { variant?: string; title: string; description?: string }[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Amelia Chen', email: 'doctor@medora.health' } }),
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

/** The server's document, with SMS on — not the client default — to prove where switches come from. */
function serverDocument(overrides: Record<string, unknown> = {}) {
  return {
    channels: { email: true, sms: true, push: true, desktop: false, inApp: true },
    quietHours: { enabled: false, from: '22:00', to: '07:00' },
    categories: {
      appointments: true,
      'medical-records': true,
      laboratory: true,
      pharmacy: true,
      patients: true,
      ai: true,
      system: true,
      security: true,
    },
    ...overrides,
  };
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Settings → Notifications over the API', () => {
  it('draws every switch from the server document, and keeps Security locked on', async () => {
    stubApi({ 'GET /me/notification-preferences': () => envelope(serverDocument()) });

    renderWithClient(<NotificationsSection />);

    expect(await screen.findByRole('switch', { name: 'SMS' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Desktop' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Security' })).toBeDisabled();
  });

  it('writes the whole document with the one change, and shows what the server stored', async () => {
    const { requests } = stubApi({
      'GET /me/notification-preferences': () => envelope(serverDocument()),
      'PUT /me/notification-preferences': (request) => envelope(request.body),
    });

    renderWithClient(<NotificationsSection />);
    await userEvent.click(await screen.findByRole('switch', { name: 'SMS' }));

    await waitFor(() =>
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1),
    );
    const put = requests.find((request) => request.method === 'PUT');
    expect(put?.body).toEqual(
      serverDocument({ channels: { ...serverDocument().channels, sms: false } }),
    );
    expect(screen.getByRole('switch', { name: 'SMS' })).toHaveAttribute('aria-checked', 'false');
    expect(toasts).toEqual([]);
  });

  it('puts a refused change back and says so', async () => {
    stubApi({
      'GET /me/notification-preferences': () => envelope(serverDocument()),
      'PUT /me/notification-preferences': () => json({ message: 'Internal', code: 'x' }, 500),
    });

    renderWithClient(<NotificationsSection />);
    const sms = await screen.findByRole('switch', { name: 'SMS' });
    await userEvent.click(sms);

    await waitFor(() =>
      expect(toasts).toContainEqual(
        expect.objectContaining({
          variant: 'error',
          title: 'Could not save notification preferences',
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'SMS' })).toHaveAttribute('aria-checked', 'true'),
    );
  });

  it('shows a failed load as an error with Retry — never as default switches', async () => {
    // What an API built from `main` answers: the route is not there.
    stubApi({
      'GET /me/notification-preferences': () =>
        json({ message: 'Cannot GET', code: 'not_found' }, 404),
    });

    renderWithClient(<NotificationsSection />);

    expect(
      await screen.findByText("Couldn't load your notification preferences"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('never lets a later document land before an earlier one', async () => {
    // Hold every PUT until the test releases it, and record how many overlap.
    const bodies: unknown[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const release: (() => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: URL | string, init: RequestInit = {}) => {
        const method = (init.method ?? 'GET').toUpperCase();
        if (method === 'GET' && String(input).includes('/me/notification-preferences')) {
          return Promise.resolve(json(envelope(serverDocument())));
        }
        if (method === 'PUT') {
          const body = JSON.parse(init.body as string) as unknown;
          bodies.push(body);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          return new Promise<Response>((resolve) => {
            release.push(() => {
              inFlight -= 1;
              resolve(json(envelope(body)));
            });
          });
        }
        return Promise.reject(new Error(`unexpected ${method} ${String(input)}`));
      }),
    );

    renderWithClient(<NotificationsSection />);
    await userEvent.click(await screen.findByRole('switch', { name: 'SMS' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Desktop' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    release.shift()?.();
    await waitFor(() => expect(bodies).toHaveLength(2));
    release.shift()?.();

    expect(maxInFlight).toBe(1);
    // The second document carries both changes: it was computed from the screen, not the server.
    expect(bodies[1]).toEqual(
      serverDocument({ channels: { ...serverDocument().channels, sms: false, desktop: true } }),
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Desktop' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(screen.getByRole('switch', { name: 'SMS' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('the Notifications page drawer over the API', () => {
  it('asks the server nothing while closed, and loads the document when opened', async () => {
    const { requests } = stubApi({
      'GET /me/notification-preferences': () => envelope(serverDocument()),
    });

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Preferences
          </button>
          <NotificationPreferencesDrawer open={open} onClose={() => setOpen(false)} />
        </>
      );
    }

    renderWithClient(<Harness />);
    await screen.findByRole('button', { name: 'Preferences' });
    expect(requests).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    await waitFor(() => expect(requests).toHaveLength(1));

    // The drawer's switch label carries its description, so the name starts with it.
    expect(await screen.findByRole('switch', { name: /^SMS/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /me/notification-preferences',
    ]);
  });
});
