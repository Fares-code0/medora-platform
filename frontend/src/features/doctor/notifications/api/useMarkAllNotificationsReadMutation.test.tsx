import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DoctorNotification } from '../model/types';

import { notificationKeys, useMarkAllNotificationsReadMutation } from './useNotificationsQuery';

/**
 * "Mark all as read" through the real hook: one service write, an optimistic
 * patch that follows the server's own rule (unread and unarchived), and an
 * exact rollback when the write fails.
 */

const markAllRead = vi.fn<() => Promise<number>>();
const fetchNotifications = vi.fn<() => Promise<readonly DoctorNotification[]>>();

vi.mock('../service', () => ({
  notificationService: {
    markAllRead: () => markAllRead(),
    fetchNotifications: () => fetchNotifications(),
    fetchBadgeCounts: () => Promise.resolve({ notifications: 0, messages: 0 }),
  },
}));

function notification(id: string, read: boolean, archived = false): DoctorNotification {
  return { id, read, archived } as unknown as DoctorNotification;
}

const seed: readonly DoctorNotification[] = [
  notification('n1', false),
  notification('n2', false),
  notification('n3', true),
  notification('n4', false, true),
];

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(notificationKeys.lists(), seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useMarkAllNotificationsReadMutation(), { wrapper });
  const list = () => client.getQueryData<readonly DoctorNotification[]>(notificationKeys.lists());
  return { hook, list };
}

beforeEach(() => {
  markAllRead.mockReset();
  fetchNotifications.mockReset();
  fetchNotifications.mockImplementation(() => new Promise(() => {}));
});

describe('useMarkAllNotificationsReadMutation', () => {
  it('sends one write and marks every unread, unarchived row before it lands', async () => {
    let resolve: (count: number) => void = () => {};
    markAllRead.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { hook, list } = setup();

    act(() => hook.result.current.mutate());

    await waitFor(() => expect(list()?.map((n) => n.read)).toEqual([true, true, true, false]));
    // The archived row keeps its state: the server's write does not touch it.
    expect(list()?.[3]).toMatchObject({ id: 'n4', read: false, archived: true });

    resolve(2);
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data).toBe(2);
    expect(markAllRead).toHaveBeenCalledTimes(1);
  });

  it('restores the exact previous list when the write fails', async () => {
    markAllRead.mockRejectedValue(new Error('down'));
    const { hook, list } = setup();

    act(() => hook.result.current.mutate());

    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(list()).toEqual(seed);
  });
});
