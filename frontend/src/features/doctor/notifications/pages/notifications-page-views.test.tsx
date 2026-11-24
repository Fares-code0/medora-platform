import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, envelope, pageOf, stubApi } from '@/test/api-stub';

import type * as Capabilities from '../model/capabilities';

import { NotificationsPage } from './NotificationsPage';

/**
 * The redesigned inbox over the live adapter: the views are the `?status=`
 * param (so older links still land on the same list), each empty view says
 * what it is empty of, a search with no hits offers to clear itself, rows
 * group by day, and a bulk action reports success only when it succeeded.
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

function daysAgo(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function view(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    body: `${title} — details`,
    category: 'laboratory',
    priority: 'normal',
    kind: 'alert',
    sender: 'Laboratory',
    readAt: null,
    archived: false,
    favorite: false,
    pinned: false,
    createdAt: daysAgo(0),
    related: {
      patientId: null,
      recordId: null,
      labOrderId: null,
      prescriptionId: null,
      appointmentId: null,
    },
    ...overrides,
  };
}

const ACTIVE = [
  view('ntf-1', 'Critical result: Hemoglobin', { priority: 'critical' }),
  view('ntf-2', 'Refill approved', {
    readAt: daysAgo(0),
    createdAt: daysAgo(1),
    favorite: true,
  }),
];
const ARCHIVED = [view('ntf-3', 'Old schedule change', { archived: true, createdAt: daysAgo(20) })];

function routes(active: readonly unknown[] = ACTIVE, archived: readonly unknown[] = ARCHIVED) {
  return {
    'GET /notifications': (request: { query: URLSearchParams }) =>
      pageOf(request.query.get('status') === 'archived' ? archived : active),
    'GET /notifications/badge-counts': () => envelope({ notifications: 1, messages: 0 }),
  };
}

let location = '';
function LocationProbe() {
  location = useLocation().search;
  return null;
}

function renderPage(url = '/doctor/notifications') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <NotificationsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const viewsNav = () => screen.getByRole('navigation', { name: 'Notification views' });
const viewButton = (name: RegExp) => within(viewsNav()).getByRole('button', { name });

describe('the notification views', () => {
  it('switches views through ?status= and filters the list to each', async () => {
    stubApi(routes());
    renderPage();

    expect(await screen.findByText('Critical result: Hemoglobin')).toBeInTheDocument();
    expect(screen.getByText('Refill approved')).toBeInTheDocument();
    expect(screen.queryByText('Old schedule change')).not.toBeInTheDocument();
    expect(viewButton(/^Inbox/)).toHaveAttribute('aria-current', 'page');

    await userEvent.click(viewButton(/^Unread/));
    expect(location).toBe('?status=unread');
    expect(viewButton(/^Unread/)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Critical result: Hemoglobin')).toBeInTheDocument();
    expect(screen.queryByText('Refill approved')).not.toBeInTheDocument();

    await userEvent.click(viewButton(/^Starred/));
    expect(location).toBe('?status=starred');
    expect(screen.getByText('Refill approved')).toBeInTheDocument();
    expect(screen.queryByText('Critical result: Hemoglobin')).not.toBeInTheDocument();

    await userEvent.click(viewButton(/^Inbox/));
    expect(location).toBe('');
  });

  it('opens an older ?status= link on the same view', async () => {
    stubApi(routes());
    renderPage('/doctor/notifications?status=archived');

    // Generous timeout: this first render lazy-loads the service and drains
    // two statuses, which can exceed the default 1 s on a loaded CI runner.
    expect(
      await screen.findByText('Old schedule change', undefined, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(viewButton(/^Archived/)).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Critical result: Hemoglobin')).not.toBeInTheDocument();
  });

  it('groups the newest-first list by day, under the full pagination count', async () => {
    stubApi(routes());
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    expect(screen.getByText('1–2 of 2')).toBeInTheDocument();
  });
});

describe('the empty states', () => {
  it("says you're all caught up when nothing is unread", async () => {
    stubApi(routes([view('ntf-2', 'Refill approved', { readAt: daysAgo(0) })]));
    renderPage('/doctor/notifications?status=unread');

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it('says there are no notifications when there are none at all', async () => {
    stubApi(routes([], []));
    renderPage();

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('offers to clear a search that matches nothing, and keeps the view', async () => {
    stubApi(routes());
    renderPage('/doctor/notifications?status=unread&q=zzz');

    expect(await screen.findByText('No notifications match')).toBeInTheDocument();
    const clears = screen.getAllByRole('button', { name: 'Clear filters' });
    const last = clears[clears.length - 1];
    if (last === undefined) throw new Error('a Clear filters button is expected');
    await userEvent.click(last);

    expect(location).toBe('?status=unread');
    expect(await screen.findByText('Critical result: Hemoglobin')).toBeInTheDocument();
  });

  it('shows the error state with a retry when the list cannot load', async () => {
    let fail = true;
    stubApi({
      ...routes(),
      'GET /notifications': (request: { query: URLSearchParams }) =>
        fail
          ? json({ message: 'Internal', code: 'x' }, 500)
          : pageOf(request.query.get('status') === 'archived' ? ARCHIVED : ACTIVE),
    });
    renderPage();

    expect(await screen.findByText("Couldn't load notifications")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('Critical result: Hemoglobin')).toBeInTheDocument();
  });
});

describe('bulk actions', () => {
  it('reports a bulk mark-read as done only once the server has kept it', async () => {
    const { requests } = stubApi({
      ...routes(),
      'POST /notifications/ntf-1/read': () => new Response(null, { status: 204 }),
      'POST /notifications/ntf-2/read': () => new Response(null, { status: 204 }),
    });
    renderPage();

    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Select all notifications on this page' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('2 selected');
    await userEvent.click(screen.getByRole('button', { name: 'Mark read' }));

    await waitFor(() =>
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'success', title: '2 notifications marked as read' }),
      ),
    );
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(2);
    expect(toasts.filter((toast) => toast.variant === 'error')).toEqual([]);
  });

  it('never claims success when a bulk write is refused', async () => {
    stubApi({
      ...routes(),
      'POST /notifications/ntf-1/archive': () => new Response(null, { status: 204 }),
      'POST /notifications/ntf-2/archive': () => json({ message: 'Nope', code: 'x' }, 500),
    });
    renderPage();

    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Select all notifications on this page' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'error', title: 'Could not update 2 notifications' }),
      ),
    );
    expect(toasts.filter((toast) => toast.variant === 'success')).toEqual([]);
  });
});
