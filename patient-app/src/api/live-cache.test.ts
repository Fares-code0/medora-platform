import { MutationObserver, QueryClient } from '@tanstack/react-query';

import { captureLive, type LiveCapture } from './live-cache';

/**
 * `captureLive` answers "is the session that sent this request still the
 * current one?" for a callback that runs after the response lands. These run
 * the capture from a real `onMutate`, which is the only place it is called.
 */

const KEY = ['privacy'] as const;

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

async function capturedInFlight(queryClient: QueryClient) {
  const observer = new MutationObserver<void, Error, void, LiveCapture>(queryClient, {
    mutationFn: () => new Promise<void>(() => undefined),
    onMutate: () => captureLive(queryClient, KEY),
  });
  void observer.mutate().catch(() => undefined);
  for (let i = 0; i < 50; i += 1) {
    if (observer.getCurrentResult().context !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const capture = observer.getCurrentResult().context;
  if (capture === undefined) throw new Error('onMutate did not run');
  return capture;
}

describe('captureLive', () => {
  it('is current while the captured query is still the live instance', async () => {
    const queryClient = client();
    queryClient.setQueryData(KEY, 'A');
    const capture = await capturedInFlight(queryClient);

    expect(capture.isCurrent()).toBe(true);
    expect(capture.liveQueries()).toHaveLength(1);
  });

  it('is not current once the cache has been cleared', async () => {
    const queryClient = client();
    queryClient.setQueryData(KEY, 'A');
    const capture = await capturedInFlight(queryClient);

    queryClient.clear();

    expect(capture.isCurrent()).toBe(false);
    expect(capture.liveQueries()).toHaveLength(0);
  });

  it('is not current when the next session has built the same key again', async () => {
    const queryClient = client();
    queryClient.setQueryData(KEY, 'A');
    const capture = await capturedInFlight(queryClient);

    queryClient.clear();
    queryClient.setQueryData(KEY, 'B');

    expect(capture.isCurrent()).toBe(false);
    expect(capture.liveQueries()).toHaveLength(0);
  });

  it('with nothing cached, follows the in-flight mutation instead', async () => {
    const queryClient = client();
    const capture = await capturedInFlight(queryClient);

    expect(capture.isCurrent()).toBe(true);

    queryClient.clear();

    expect(capture.isCurrent()).toBe(false);
  });
});
