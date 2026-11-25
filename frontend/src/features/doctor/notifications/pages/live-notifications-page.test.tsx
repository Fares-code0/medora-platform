import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import type * as Capabilities from '../model/capabilities';

import { NotificationsPage } from './NotificationsPage';

/**
 * The Notifications page in a live build: archive, favourite, pin and
 * clear-read over API §10 (served on `backend`, RM M19.3), with only the
 * network stubbed. The list is optimistic and rolls itself back (DP-05);
 * what this pins is that a refused write is then **said**, so a row that
 * comes back is never a silent mystery — the case an API built from `main`
 * produces, where these routes answer 404.
 */

vi.mock('../model/capabilities', async (importOriginal) => {
  const actual: typeof Capabilities = await importOriginal();
  return { ...actual, notificationCapabilities: actual.HTTP_NOTIFICATION_CAPABILITIES };
});

vi.mock('../service', async () => {
  const { httpNotificationService } = await import('../http/http-notification-service');
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

function notificationView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ntf-1',
    title: 'Critical result: Hemoglobin',
    body: 'LAB-100000 was released with a critical value.',
    category: 'laboratory',
    priority: 'critical',
    kind: 'alert',
    sender: 'Laboratory',
    readAt: '2026-10-24T09:00:00.000Z',
    archived: false,
    favorite: false,
    pinned: false,
    createdAt: '2026-10-24T08:11:36.000Z',
    related: {
      patientId: null,
      recordId: null,
      labOrderId: 'LAB-100000',
      prescriptionId: null,
      appointmentId: null,
    },
    ...overrides,
  };
}

const baseRoutes = {
  'GET /notifications': (request: { query: URLSearchParams }) =>
    pageOf(request.query.get('status') === 'archived' ? [] : [notificationView()]),
  'GET /notifications/badge-counts': () => envelope({ notifications: 0, messages: 0 }),
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/doctor/notifications']}>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openRowMenu() {
  await userEvent.click(
    await screen.findByRole('button', { name: /Actions for "Critical result: Hemoglobin"/ }),
  );
}

describe('NotificationsPage over the API', () => {
  it('archives through the server and claims nothing on screen', async () => {
    const { requests } = stubApi({
      ...baseRoutes,
      'POST /notifications/ntf-1/archive': () => new Response(null, { status: 204 }),
    });

    renderPage();
    await openRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    await waitFor(() =>
      expect(requests.map((request) => `${request.method} ${request.path}`)).toContain(
        'POST /notifications/ntf-1/archive',
      ),
    );
    expect(
      requests.find((request) => request.path === '/notifications/ntf-1/archive')?.body,
    ).toEqual({ value: true });
    expect(toasts.filter((toast) => toast.variant === 'error')).toEqual([]);
  });

  it('says so when the server refuses an archive, and puts the row back', async () => {
    stubApi({
      ...baseRoutes,
      'POST /notifications/ntf-1/archive': () =>
        json({ message: 'Cannot POST', code: 'not_found' }, 404),
    });

    renderPage();
    await openRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    await waitFor(() =>
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'error', title: 'Could not update the notification' }),
      ),
    );
    expect(await screen.findByText('Critical result: Hemoglobin')).toBeInTheDocument();
  });

  it('clears read notifications with the server’s count, and says so when it refuses', async () => {
    let refuse = false;
    stubApi({
      ...baseRoutes,
      'POST /notifications/clear-read': () =>
        refuse ? json({ message: 'Internal', code: 'x' }, 500) : envelope({ archived: 1 }),
    });

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Clear read' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Archive read' }));
    await waitFor(() =>
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'success', title: '1 read notification archived' }),
      ),
    );

    refuse = true;
    await userEvent.click(screen.getByRole('button', { name: 'Clear read' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Archive read' }));
    await waitFor(() =>
      expect(toasts).toContainEqual(
        expect.objectContaining({
          variant: 'error',
          title: 'Could not archive read notifications',
        }),
      ),
    );
  });

  it('keeps Clear read and Preferences in the inbox toolbar, not the page header', async () => {
    stubApi(baseRoutes);
    renderPage();

    const clearRead = await screen.findByRole('button', { name: 'Clear read' });
    const preferences = screen.getByRole('button', { name: 'Preferences' });
    // The page header carries the page's identity and breadcrumb, not inbox actions.
    const header = screen.getByRole('heading', { level: 1, name: 'Notifications' }).closest('header');
    expect(header).not.toBeNull();
    expect(header).not.toContainElement(clearRead);
    expect(header).not.toContainElement(preferences);
    // They share the toolbar row with the search and the Filters button.
    const group = screen.getByRole('button', { name: /^Filters/ }).parentElement;
    expect(group).toContainElement(clearRead);
    expect(group).toContainElement(preferences);
    expect(group).toHaveClass('flex-wrap');

    await userEvent.click(preferences);
    expect(await screen.findByText('Notification preferences')).toBeInTheDocument();
  });

  it('shows Clear read and Preferences on the Notifications tab only, not on Messages', async () => {
    stubApi(baseRoutes);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Clear read' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Messages/ }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Clear read' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Preferences' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Notifications/ }));
    expect(await screen.findByRole('button', { name: 'Clear read' })).toBeInTheDocument();
  });

  it('offers no Delete, because no branch serves one', async () => {
    stubApi(baseRoutes);
    renderPage();
    await openRowMenu();
    await screen.findByRole('menuitem', { name: 'Archive' });
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
