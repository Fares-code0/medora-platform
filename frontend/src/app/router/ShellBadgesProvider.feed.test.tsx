import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Seam from '@/api/seam';
import { useShellBadges } from '@/layouts';
import { envelope, pageOf, stubApi, type StubbedRequest } from '@/test/api-stub';

import { ShellBadgesProvider } from './ShellBadgesProvider';

/**
 * The bell's feed is one small read, not the Notifications page's drain.
 *
 * The provider is mounted on every page of every workspace with a bell. It
 * used to observe the page's full list query — every page of `active` and
 * every page of `archived` — to show six rows, and every read toggle's
 * reconcile re-drained all of it. What is pinned here: the feed asks for
 * one page sized to the feed, and marking a row read refetches that page
 * and the badge, never the full list.
 */

// The live adapters, as a build without the mock backend selects them.
vi.mock('@/api/seam', async (importOriginal) => {
  const actual: typeof Seam = await importOriginal();
  return {
    ...actual,
    selectService: <T,>(implementations: { readonly mock: T; readonly http: T }) =>
      implementations.http,
  };
});

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Amelia Chen', role: 'doctor' } }),
  useToast: () => ({ toast: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function notificationView(id: string, readAt: string | null) {
  return {
    id,
    title: `Notification ${id}`,
    body: 'Body',
    category: 'laboratory',
    priority: 'normal',
    kind: 'update',
    sender: 'Laboratory',
    readAt,
    archived: false,
    favorite: false,
    pinned: false,
    createdAt: '2026-10-24T08:11:36.000Z',
    related: {
      patientId: null,
      recordId: null,
      labOrderId: null,
      prescriptionId: null,
      appointmentId: null,
    },
  };
}

function Feed() {
  const { feed, markRead } = useShellBadges();
  if (feed === null) return <p>loading</p>;
  return (
    <ul>
      {feed.map((item) => (
        <li key={item.id}>
          <button type="button" onClick={() => markRead(item.id)}>
            {item.title}
            {item.unread ? ' (unread)' : ''}
          </button>
        </li>
      ))}
    </ul>
  );
}

function renderFeed() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ShellBadgesProvider>
        <Feed />
      </ShellBadgesProvider>
    </QueryClientProvider>,
  );
}

const listReads = (requests: readonly StubbedRequest[]) =>
  requests.filter((request) => request.method === 'GET' && request.path === '/notifications');

describe('the shell bell feed', () => {
  it('asks for one page of active notifications, sized to the feed', async () => {
    const { requests } = stubApi({
      'GET /notifications': () => pageOf([notificationView('ntf-1', null)]),
      'GET /notifications/badge-counts': () => envelope({ notifications: 1, messages: 0 }),
    });

    renderFeed();
    // The first test pays for loading the lazily imported adapter.
    expect(
      await screen.findByRole('button', { name: /Notification ntf-1/ }, { timeout: 5000 }),
    ).toBeInTheDocument();

    const reads = listReads(requests);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.query.get('status')).toBe('active');
      expect(read.query.get('page')).toBe('1');
      expect(read.query.get('pageSize')).toBe('6');
    }
  });

  it('marks a row read without re-draining the full list', async () => {
    let readAt: string | null = null;
    const { requests } = stubApi({
      'GET /notifications': () => pageOf([notificationView('ntf-1', readAt)]),
      'GET /notifications/badge-counts': () =>
        envelope({ notifications: readAt === null ? 1 : 0, messages: 0 }),
      'POST /notifications/ntf-1/read': () => {
        readAt = '2026-10-24T09:00:00.000Z';
        return new Response(null, { status: 204 });
      },
    });

    renderFeed();
    const row = await screen.findByRole(
      'button',
      { name: 'Notification ntf-1 (unread)' },
      { timeout: 5000 },
    );
    const readsBefore = listReads(requests).length;
    await userEvent.click(row);

    await waitFor(() =>
      expect(requests.map((request) => `${request.method} ${request.path}`)).toContain(
        'POST /notifications/ntf-1/read',
      ),
    );
    // The reconcile refetches the feed's one page (and the badge) …
    await waitFor(() => expect(listReads(requests).length).toBeGreaterThan(readsBefore));
    expect(await screen.findByRole('button', { name: 'Notification ntf-1' })).toBeInTheDocument();

    // … and never the full drain: no archived half, no 100-row pages.
    for (const read of listReads(requests)) {
      expect(read.query.get('status')).toBe('active');
      expect(read.query.get('pageSize')).toBe('6');
    }
    expect(requests.some((request) => request.path === '/conversations')).toBe(false);
  });
});
