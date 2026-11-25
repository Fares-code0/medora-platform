import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DoctorNotification } from '../model/types';

import { recentNotificationsKey, useUpdateNotificationsMutation } from './useNotificationsQuery';

/**
 * The bell's feed is the server's first page, which the server orders pinned
 * first, then newest. Pinning or unpinning a row optimistically must keep that
 * order in the cache at once, not leave the row in place until the reconcile
 * refetch lands.
 */

const updateNotifications = vi.fn<() => Promise<void>>();

vi.mock('../service', () => ({
  notificationService: {
    updateNotifications: () => updateNotifications(),
    fetchNotifications: () => new Promise(() => {}),
    fetchRecent: () => new Promise(() => {}),
    fetchBadgeCounts: () => Promise.resolve({ notifications: 0, messages: 0 }),
  },
}));

function row(id: string, createdAt: string, pinned = false): DoctorNotification {
  return { id, createdAt, pinned, read: false, archived: false } as unknown as DoctorNotification;
}

const FEED_KEY = recentNotificationsKey(6);

function setup(seed: readonly DoctorNotification[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(FEED_KEY, seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateNotificationsMutation(), { wrapper });
  const ids = () =>
    client.getQueryData<readonly DoctorNotification[]>(FEED_KEY)?.map((n) => n.id) ?? [];
  return { hook, ids };
}

beforeEach(() => {
  updateNotifications.mockReset();
  // The write stays in flight: what is asserted is the optimistic cache.
  updateNotifications.mockImplementation(() => new Promise(() => {}));
});

describe('the bell feed keeps the server order under an optimistic pin', () => {
  it('moves a newly pinned row to the top before the write lands', async () => {
    const { hook, ids } = setup([
      row('newest', '2026-11-24T10:00:00Z'),
      row('middle', '2026-11-24T09:00:00Z'),
      row('oldest', '2026-11-24T08:00:00Z'),
    ]);

    act(() => hook.result.current.mutate({ ids: ['oldest'], patch: { pinned: true } }));

    await waitFor(() => expect(ids()).toEqual(['oldest', 'newest', 'middle']));
  });

  it('returns an unpinned row to its date position', async () => {
    const { hook, ids } = setup([
      row('pinned-old', '2026-11-24T07:00:00Z', true),
      row('newest', '2026-11-24T10:00:00Z'),
      row('middle', '2026-11-24T09:00:00Z'),
    ]);

    act(() => hook.result.current.mutate({ ids: ['pinned-old'], patch: { pinned: false } }));

    await waitFor(() => expect(ids()).toEqual(['newest', 'middle', 'pinned-old']));
  });
});
