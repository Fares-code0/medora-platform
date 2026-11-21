import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { notificationKeys } from './keys';
import { notificationService } from './service';
import {
  UNREAD_BADGE_CAP,
  UNREAD_POLL_INTERVAL_MS,
  formatUnreadBadge,
  unreadPollInterval,
  unreadTabAnnouncement,
} from './unread';
import { useIsForeground, useUnreadCount } from './useUnreadCount';

/**
 * The unread badge on the tab bar — checklist O-02 and F-07.
 *
 * The two rows ask for four things between them: a badge, a foreground-
 * only poll, a 99+ cap, and no invented count where no endpoint exists.
 * The first three are asserted here. The fourth is asserted by absence —
 * there is one badge in `AppTabs` and it reads the one live count.
 */

describe('the 99+ cap (O-02, F-07)', () => {
  it('shows the number up to the cap', () => {
    expect(formatUnreadBadge(1)).toBe('1');
    expect(formatUnreadBadge(42)).toBe('42');
    expect(formatUnreadBadge(UNREAD_BADGE_CAP)).toBe('99');
  });

  it('shows 99+ past it', () => {
    expect(formatUnreadBadge(UNREAD_BADGE_CAP + 1)).toBe('99+');
    expect(formatUnreadBadge(4_120)).toBe('99+');
  });

  it('shows no badge at zero rather than a badge reading zero', () => {
    // A badge that is always there is a badge nobody looks at.
    expect(formatUnreadBadge(0)).toBeNull();
  });

  it('shows no badge for a count it does not have', () => {
    // Before the first response, and after a failure. The badge fails
    // quiet: a wrong number on a tab bar is worse than no number.
    expect(formatUnreadBadge(undefined)).toBeNull();
    expect(formatUnreadBadge(Number.NaN)).toBeNull();
    expect(formatUnreadBadge(-3)).toBeNull();
  });
});

describe('what a screen reader hears (S-02)', () => {
  /**
   * Since C-09 the rule and the sentence are separate: this function
   * decides WHETHER there is something to announce and with WHICH count,
   * and `AppTabs.unreadTabLabel` asks the catalogue for the words. The
   * assertions moved with the split — they are about the decision, and
   * `notifications.test.tsx` covers the wording that comes out of it.
   */
  it('carries a count, since the badge itself is not announced', () => {
    expect(unreadTabAnnouncement(3)).toEqual({ count: 3 });
  });

  it('distinguishes one from many, which the two catalogue keys need', () => {
    expect(unreadTabAnnouncement(1)).toEqual({ count: 1 });
  });

  it('reports the real number even where the badge says 99+', () => {
    // The cap exists because of tab width. A screen reader has none.
    expect(unreadTabAnnouncement(250)).toEqual({ count: 250 });
  });

  it('announces nothing extra when there is nothing unread', () => {
    expect(unreadTabAnnouncement(0)).toBeNull();
    expect(unreadTabAnnouncement(undefined)).toBeNull();
    expect(unreadTabAnnouncement(Number.NaN)).toBeNull();
    expect(unreadTabAnnouncement(-3)).toBeNull();
  });
});

describe('the poll runs on the foreground only (F-07)', () => {
  it('polls while the app is in front and online', () => {
    expect(unreadPollInterval({ isForeground: true, isOnline: true })).toBe(
      UNREAD_POLL_INTERVAL_MS,
    );
  });

  it('is within the 10–15 s the row asks for', () => {
    expect(UNREAD_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
    expect(UNREAD_POLL_INTERVAL_MS).toBeLessThanOrEqual(15_000);
  });

  it('does not poll in the background', () => {
    // There is nobody to show a badge to, and T-11 may have ended the
    // session before the app comes back.
    expect(unreadPollInterval({ isForeground: false, isOnline: true })).toBe(false);
  });

  it('does not poll while offline', () => {
    // A poll that cannot reach the server is a retry loop on a timer.
    expect(unreadPollInterval({ isForeground: false, isOnline: false })).toBe(false);
    expect(unreadPollInterval({ isForeground: true, isOnline: false })).toBe(false);
  });
});

/** A fake `AppState` whose `remove()` really removes. */
function captureAppState() {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return {
      remove: () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  });

  return (state: AppStateStatus) => {
    act(() => {
      for (const listener of [...listeners]) listener(state);
    });
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useIsForeground', () => {
  it('starts in the foreground and follows the app to the background and back', () => {
    const emit = captureAppState();
    const { result } = renderHook(() => useIsForeground());

    expect(result.current).toBe(true);

    emit('background');
    expect(result.current).toBe(false);

    emit('active');
    expect(result.current).toBe(true);
  });

  it('treats inactive as still in front', () => {
    // A control-centre swipe or a call banner. It lasts a moment, and
    // stopping a 15 s poll around it costs a request rather than saving
    // one. `PhiPrivacyShield` treats the same state as obscuring, which
    // is why the two do not share a hook.
    const emit = captureAppState();
    const { result } = renderHook(() => useIsForeground());

    emit('inactive');
    expect(result.current).toBe(true);
  });
});

function queryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper };
}

describe('useUnreadCount', () => {
  it('reads the server-side count rather than counting the feed', async () => {
    // The feed is one page of twenty; the badge is over every unread
    // unarchived row. Counting the feed under-reports exactly when a
    // badge matters.
    const count = jest.spyOn(notificationService, 'unreadCount').mockResolvedValue(7);
    const list = jest.spyOn(notificationService, 'list');
    const { Wrapper } = queryWrapper();

    const { result } = renderHook(() => useUnreadCount(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.count).toBe(7));
    expect(count).toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('holds no count when the read fails, so no badge is drawn', async () => {
    jest
      .spyOn(notificationService, 'unreadCount')
      .mockRejectedValue(new Error('badge counts unavailable'));
    const { Wrapper } = queryWrapper();

    const { result } = renderHook(() => useUnreadCount(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.count).toBeUndefined());
    expect(formatUnreadBadge(result.current.count)).toBeNull();
  });

  it('caches under the notifications prefix, so the logout sweep takes it', () => {
    // `clearPhiCache` removes by domain prefix. The count is not PHI, but
    // it is the previous patient's count and must not survive into the
    // next session's tab bar (T-03, T-08).
    expect(notificationKeys.unreadCount()[0]).toBe('notifications');
  });

  it('is not stored under the feed key, whose optimistic rewrites assume an array', () => {
    expect(notificationKeys.unreadCount()).not.toEqual(notificationKeys.lists());
    expect(notificationKeys.unreadCount()).toContain('unread-count');
  });
});
