import { QueryClient } from '@tanstack/react-query';

import { optimisticUpdate, type OptimisticContext } from './optimistic';

/**
 * The optimistic-update pattern — checklist R-07.
 *
 * The three steps are asserted separately because each of them is a bug
 * somebody has shipped: an update that a racing refetch undoes, an
 * update with no snapshot to undo it, and a failure that leaves the lie
 * on screen.
 */

interface Note {
  readonly id: string;
  readonly read: boolean;
}

const UNREAD: Note[] = [
  { id: 'a', read: false },
  { id: 'b', read: false },
];

function markRead(notes: Note[], id: string): Note[] {
  return notes.map((note) => (note.id === id ? { ...note, read: true } : note));
}

function harness(options: { onRollback?: () => void } = {}) {
  // `gcTime: Infinity` keeps these assertions about the cache, and keeps
  // the suite from leaving a garbage-collection timer running after the
  // last test.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const callbacks = optimisticUpdate<string, Note[]>({
    queryClient,
    queryKey: ['notes'],
    apply: markRead,
    ...(options.onRollback === undefined ? {} : { onRollback: options.onRollback }),
  });

  // TanStack hands every mutation callback a `MutationFunctionContext`
  // this module ignores. The tests build the smallest real one rather
  // than casting the signatures away, so a change to them fails here.
  const fnContext = { client: queryClient, meta: undefined };

  return {
    queryClient,
    async mutate(id: string): Promise<OptimisticContext | undefined> {
      return callbacks.onMutate?.(id, fnContext);
    },
    async fail(id: string, result: OptimisticContext | undefined) {
      await callbacks.onError?.(new Error('offline'), id, result, fnContext);
    },
    async settle(id: string, result: OptimisticContext | undefined) {
      await callbacks.onSettled?.(undefined, null, id, result, fnContext);
    },
  };
}

describe('applying the update', () => {
  it('writes the expected value into every matching query', async () => {
    const { queryClient, mutate } = harness();
    queryClient.setQueryData(['notes', 'list', {}], UNREAD);
    queryClient.setQueryData(['notes', 'list', { unreadOnly: true }], UNREAD);

    await mutate('a');

    expect(queryClient.getQueryData(['notes', 'list', {}])).toEqual([
      { id: 'a', read: true },
      { id: 'b', read: false },
    ]);
    expect(queryClient.getQueryData(['notes', 'list', { unreadOnly: true }])).toEqual([
      { id: 'a', read: true },
      { id: 'b', read: false },
    ]);
  });

  it('leaves a query that holds nothing alone rather than inventing a list', async () => {
    const { queryClient, mutate } = harness();

    await mutate('a');

    expect(queryClient.getQueryData(['notes', 'list', {}])).toBeUndefined();
  });

  it('cancels an in-flight refetch, which would otherwise land last and win', async () => {
    const { queryClient, mutate } = harness();
    queryClient.setQueryData(['notes', 'list', {}], UNREAD);
    const cancel = jest.spyOn(queryClient, 'cancelQueries');

    await mutate('a');

    expect(cancel).toHaveBeenCalledWith({ queryKey: ['notes'] });
  });
});

describe('rolling back', () => {
  it('restores exactly what was there before', async () => {
    const { queryClient, mutate, fail } = harness();
    queryClient.setQueryData(['notes', 'list', {}], UNREAD);

    const context = await mutate('a');
    await fail('a', context);

    expect(queryClient.getQueryData(['notes', 'list', {}])).toEqual(UNREAD);
  });

  it('tells the call site, after the cache is already back', async () => {
    const seen: (Note[] | undefined)[] = [];
    const harnessed = harness({
      onRollback: () => {
        seen.push(harnessed.queryClient.getQueryData(['notes', 'list', {}]));
      },
    });
    harnessed.queryClient.setQueryData(['notes', 'list', {}], UNREAD);

    const context = await harnessed.mutate('a');
    await harnessed.fail('a', context);

    // The message must never describe a screen that has not been put
    // back yet, so by the time it runs the old value is already there.
    expect(seen).toEqual([UNREAD]);
  });

  it('does nothing when there is no snapshot, rather than throwing over a failure', async () => {
    // `onMutate` can be skipped entirely — a mutation cancelled before
    // it started has no snapshot, and that must not turn one failure
    // into two.
    const { queryClient, fail } = harness();
    queryClient.setQueryData(['notes', 'list', {}], UNREAD);

    await fail('a', undefined);

    expect(queryClient.getQueryData(['notes', 'list', {}])).toEqual(UNREAD);
  });
});

describe('handing authority back to the server', () => {
  it('invalidates on success as well as on failure', async () => {
    const { queryClient, mutate, settle } = harness();
    queryClient.setQueryData(['notes', 'list', {}], UNREAD);
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    const context = await mutate('a');
    await settle('a', context);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notes'] });
  });
});
