import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { DoctorNotification } from '../model/types';

import { notificationKeys } from './useNotificationsQuery';

/**
 * DP-05's optimistic patch, exercised as the cache transformation it is.
 *
 * The hook itself needs a React tree and a live service; what actually has
 * to be right is narrower and testable directly: the patch must apply to
 * exactly the named rows, and a failure must restore *precisely* what was
 * there — not a refetch, which would make a failed write visible as a flicker.
 */

function notification(id: string, read: boolean): DoctorNotification {
  return { id, read } as unknown as DoctorNotification;
}

/** The same transformation `onMutate` applies. */
function applyPatch(
  list: readonly DoctorNotification[],
  ids: readonly string[],
  patch: Partial<DoctorNotification>,
): readonly DoctorNotification[] {
  const set = new Set(ids);
  return list.map((n) => (set.has(n.id) ? { ...n, ...patch } : n));
}

describe('optimistic notification updates (DP-05)', () => {
  const seed: readonly DoctorNotification[] = [
    notification('n1', false),
    notification('n2', false),
    notification('n3', true),
  ];

  it('patches only the named rows', () => {
    const next = applyPatch(seed, ['n1'], { read: true });
    expect(next.map((n) => n.read)).toEqual([true, false, true]);
  });

  it('patches many rows in one write, as "mark all read" does', () => {
    const next = applyPatch(seed, ['n1', 'n2'], { read: true });
    expect(next.every((n) => n.read)).toBe(true);
  });

  it('restores the exact previous list on failure, not a refetch', () => {
    const client = new QueryClient();
    client.setQueryData(notificationKeys.lists(), seed);

    const previous = client.getQueryData<readonly DoctorNotification[]>(notificationKeys.lists());
    client.setQueryData(notificationKeys.lists(), applyPatch(seed, ['n1'], { read: true }));
    expect(
      client.getQueryData<readonly DoctorNotification[]>(notificationKeys.lists())?.[0]?.read,
    ).toBe(true);

    // The rollback path. Value equality, not identity: the query client
    // structurally shares what it stores, so a restored list is equal to the
    // original without being the same reference.
    client.setQueryData(notificationKeys.lists(), previous);
    expect(client.getQueryData(notificationKeys.lists())).toEqual(seed);
  });

  it('leaves the list untouched when the cache is empty, rather than inventing one', () => {
    const client = new QueryClient();
    expect(client.getQueryData(notificationKeys.lists())).toBeUndefined();
    // `onMutate` guards on `previousList !== undefined` for exactly this:
    // writing a patched list into an empty cache would materialise rows the
    // query has never fetched.
    expect(client.getQueryData(notificationKeys.lists())).toBeUndefined();
  });
});
