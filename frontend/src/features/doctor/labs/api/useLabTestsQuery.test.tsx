import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LabTest } from '../model/types';
import { labService } from '../service';

import { labKeys, useLabTestQuery, useLabTestsQuery } from './useLabTestsQuery';

const order = (id: string, reviewed = false) => ({ id, reviewed }) as unknown as LabTest;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('opening an order from the worklist', () => {
  it('starts from the worklist row, so opening one issues no second GET', async () => {
    const list = vi.spyOn(labService, 'listLabTests').mockResolvedValue([order('a'), order('b')]);
    const detail = vi.spyOn(labService, 'getLabTest').mockResolvedValue(order('a'));
    const { wrapper } = setup();

    const worklist = renderHook(() => useLabTestsQuery(), { wrapper });
    await waitFor(() => expect(worklist.result.current.data).toHaveLength(2));

    const opened = renderHook(() => useLabTestQuery('a'), { wrapper });
    expect(opened.result.current.data).toEqual(order('a'));

    expect(list).toHaveBeenCalledTimes(1);
    expect(detail).not.toHaveBeenCalled();
  });

  it('never writes detail entries from the list read itself', async () => {
    vi.spyOn(labService, 'listLabTests').mockResolvedValue([order('a')]);
    const { client, wrapper } = setup();

    const worklist = renderHook(() => useLabTestsQuery(), { wrapper });
    await waitFor(() => expect(worklist.result.current.data).toHaveLength(1));

    expect(client.getQueryData(labKeys.detail('a'))).toBeUndefined();
  });

  it('does not recreate orders from a read that resolves after the cache was cleared', async () => {
    const pending = deferred<LabTest[]>();
    vi.spyOn(labService, 'listLabTests').mockReturnValue(pending.promise);
    const detail = vi.spyOn(labService, 'getLabTest').mockResolvedValue(order('fresh'));
    const { client, wrapper } = setup();

    const worklist = renderHook(() => useLabTestsQuery(), { wrapper });
    worklist.unmount();
    // Sign-out / lock: AuthProvider drops the whole cache.
    client.clear();
    pending.resolve([order('previous-session')]);
    await pending.promise;

    expect(client.getQueryData(labKeys.lists())).toBeUndefined();
    expect(client.getQueryData(labKeys.detail('previous-session'))).toBeUndefined();

    const opened = renderHook(() => useLabTestQuery('previous-session'), { wrapper });
    await waitFor(() => expect(detail).toHaveBeenCalledWith('previous-session'));
    await waitFor(() => expect(opened.result.current.data).toEqual(order('fresh')));
  });

  it('keeps a detail entry a mutation wrote, over an older worklist row', async () => {
    vi.spyOn(labService, 'listLabTests').mockResolvedValue([order('a', false)]);
    const detail = vi.spyOn(labService, 'getLabTest');
    const { client, wrapper } = setup();

    const worklist = renderHook(() => useLabTestsQuery(), { wrapper });
    await waitFor(() => expect(worklist.result.current.data).toHaveLength(1));
    // useMarkReviewedMutation's onSuccess.
    client.setQueryData(labKeys.detail('a'), order('a', true));

    const opened = renderHook(() => useLabTestQuery('a'), { wrapper });
    expect(opened.result.current.data).toEqual(order('a', true));
    expect(detail).not.toHaveBeenCalled();
  });

  it('does not use the worklist once it has been invalidated', async () => {
    vi.spyOn(labService, 'listLabTests').mockResolvedValue([order('a', false)]);
    const detail = vi.spyOn(labService, 'getLabTest').mockResolvedValue(order('a', true));
    const { client, wrapper } = setup();

    const worklist = renderHook(() => useLabTestsQuery(), { wrapper });
    await waitFor(() => expect(worklist.result.current.data).toHaveLength(1));
    worklist.unmount();
    await client.invalidateQueries({ queryKey: labKeys.lists(), refetchType: 'none' });

    const opened = renderHook(() => useLabTestQuery('a'), { wrapper });
    expect(opened.result.current.data).toBeUndefined();
    await waitFor(() => expect(opened.result.current.data).toEqual(order('a', true)));
    expect(detail).toHaveBeenCalledTimes(1);
  });

  it('does not use a worklist whose latest read failed (fail closed)', async () => {
    const list = vi
      .spyOn(labService, 'listLabTests')
      .mockResolvedValueOnce([order('a')])
      .mockRejectedValueOnce(new Error('forbidden'));
    const detail = vi.spyOn(labService, 'getLabTest').mockRejectedValue(new Error('forbidden'));
    const { client, wrapper } = setup();

    const worklist = renderHook(() => useLabTestsQuery(), { wrapper });
    await waitFor(() => expect(worklist.result.current.data).toHaveLength(1));
    await client.refetchQueries({ queryKey: labKeys.lists() });
    await waitFor(() => expect(worklist.result.current.isError).toBe(true));
    expect(list).toHaveBeenCalledTimes(2);

    const opened = renderHook(() => useLabTestQuery('a'), { wrapper });
    expect(opened.result.current.data).toBeUndefined();
    await waitFor(() => expect(detail).toHaveBeenCalledWith('a'));
  });

  it('carries the worklist age over, so a stale row still refetches', async () => {
    vi.spyOn(labService, 'listLabTests').mockResolvedValue([order('a', false)]);
    const detail = vi.spyOn(labService, 'getLabTest').mockResolvedValue(order('a', true));
    const { client, wrapper } = setup();

    const worklist = renderHook(() => useLabTestsQuery(), { wrapper });
    await waitFor(() => expect(worklist.result.current.data).toHaveLength(1));
    const listQuery = client.getQueryCache().find({ queryKey: labKeys.lists() });
    listQuery?.setState({ dataUpdatedAt: Date.now() - 60_000 });

    const opened = renderHook(() => useLabTestQuery('a'), { wrapper });
    expect(opened.result.current.data).toEqual(order('a', false));
    await waitFor(() => expect(opened.result.current.data).toEqual(order('a', true)));
    expect(detail).toHaveBeenCalledTimes(1);
  });
});
