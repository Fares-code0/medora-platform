import NetInfo from '@react-native-community/netinfo';
import { onlineManager, useMutation, useQuery } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { Button, Text } from '@/components';
import { renderWithProviders } from '@/test/render';

import { isOnlineFrom, NetworkProvider, useNetworkStatus } from './NetworkProvider';

/**
 * Connectivity reaches two places — checklist R-04.
 *
 * The banner half has been tested through the screens that render it
 * since R-04 closed. **The cache half was not wired at all**, and that is
 * what most of this file is about: `query-client.ts` has asked for
 * `refetchOnReconnect` since it was written, and TanStack Query learns
 * about connectivity from `onlineManager`, whose default listener is the
 * browser's `online`/`offline` events. React Native fires neither, so the
 * cache believed it was online forever and no reconnect ever happened.
 *
 * The tests below hold the fix and, as importantly, hold the two things
 * the fix must NOT do: no read may hang in a paused state with nothing
 * behind it, and no write may be held and replayed (audit §12.4).
 */

/** A NetInfo whose listener this test drives. */
function captureNetInfo() {
  const listeners: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void)[] = [];
  jest.spyOn(NetInfo, 'addEventListener').mockImplementation(((listener: (s: unknown) => void) => {
    listeners.push(listener);
    return () => undefined;
  }) as unknown as typeof NetInfo.addEventListener);

  return (isOnline: boolean) => {
    act(() => {
      for (const listener of [...listeners]) {
        listener({ isConnected: isOnline, isInternetReachable: isOnline });
      }
    });
  };
}

describe('one definition of online', () => {
  it('is offline only when the radio has no link', () => {
    expect(isOnlineFrom({ isConnected: false, isInternetReachable: true } as never)).toBe(false);
  });

  it('is offline when the link goes nowhere — a captive portal is connected and useless', () => {
    expect(isOnlineFrom({ isConnected: true, isInternetReachable: false } as never)).toBe(false);
  });

  it('is online while reachability is still unknown, so no banner flashes on a cold start', () => {
    expect(isOnlineFrom({ isConnected: true, isInternetReachable: null } as never)).toBe(true);
  });
});

function Status() {
  const { isOnline, isUnknown } = useNetworkStatus();
  return <Text testID="status">{isUnknown ? 'unknown' : isOnline ? 'online' : 'offline'}</Text>;
}

describe('the banner half', () => {
  it('starts unknown rather than offline', () => {
    captureNetInfo();
    const view = renderWithProviders(
      <NetworkProvider>
        <Status />
      </NetworkProvider>,
    );
    expect(view.getByText('unknown')).toBeTruthy();
  });

  it('follows NetInfo in both directions', () => {
    const setOnline = captureNetInfo();
    const view = renderWithProviders(
      <NetworkProvider>
        <Status />
      </NetworkProvider>,
    );

    setOnline(false);
    expect(view.getByText('offline')).toBeTruthy();

    setOnline(true);
    expect(view.getByText('online')).toBeTruthy();
  });
});

describe('the cache half — `refetchOnReconnect` is real now', () => {
  it('tells `onlineManager` what NetInfo reported', () => {
    const setOnline = captureNetInfo();
    renderWithProviders(
      <NetworkProvider>
        <Status />
      </NetworkProvider>,
    );

    setOnline(false);
    expect(onlineManager.isOnline()).toBe(false);

    setOnline(true);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('re-asks the server for what is on screen when the signal comes back', async () => {
    const setOnline = captureNetInfo();
    const fetcher = jest.fn().mockResolvedValue('first');

    function Screen() {
      const query = useQuery({
        queryKey: ['reconnect-demo'],
        queryFn: fetcher,
        refetchOnReconnect: true,
        staleTime: 0,
      });
      return <Text testID="value">{query.data ?? 'pending'}</Text>;
    }

    const view = renderWithProviders(
      <NetworkProvider>
        <Screen />
      </NetworkProvider>,
    );
    await waitFor(() => expect(view.getByText('first')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Signal lost, then found. Before this was wired the cache saw
    // neither event, and a patient leaving a lift kept yesterday's page
    // until they found Retry.
    setOnline(false);
    fetcher.mockResolvedValue('second');
    setOnline(true);

    await waitFor(() => expect(view.getByText('second')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not pause a read taken offline — it fails, and the screen can say so', async () => {
    const setOnline = captureNetInfo();
    const fetcher = jest.fn().mockRejectedValue(new Error('no signal'));

    function Screen() {
      const query = useQuery({ queryKey: ['offline-read'], queryFn: fetcher, retry: false });
      return <Text testID="state">{query.isError ? 'error' : query.fetchStatus}</Text>;
    }

    const view = renderWithProviders(
      <NetworkProvider>
        <Screen />
      </NetworkProvider>,
    );
    setOnline(false);

    // `paused` is what the library default would give, and an
    // `AsyncBoundary` renders that as a skeleton with nothing coming.
    await waitFor(() => expect(view.getByText('error')).toBeTruthy());
    expect(fetcher).toHaveBeenCalled();
  });

  it('does not hold a write for later — audit §12.4 forbids the queue', async () => {
    const setOnline = captureNetInfo();
    const send = jest.fn().mockRejectedValue(new Error('no signal'));

    function Screen() {
      const mutation = useMutation({ mutationFn: send });
      return (
        <>
          <Text testID="state">{mutation.isError ? 'failed' : mutation.status}</Text>
          <Button label="Send" testID="send" onPress={() => mutation.mutate()} />
        </>
      );
    }

    const view = renderWithProviders(
      <NetworkProvider>
        <Screen />
      </NetworkProvider>,
    );

    setOnline(false);
    fireEvent.press(view.getByTestId('send'));

    // `paused` is what the library default would give while offline, and
    // a paused mutation is a queued one: it runs when the signal comes
    // back, against a slot that may be gone.
    await waitFor(() => expect(view.getByText('failed')).toBeTruthy());
    expect(send).toHaveBeenCalledTimes(1);

    setOnline(true);
    await act(async () => undefined);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
