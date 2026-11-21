import { useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { useNetworkStatus } from '@/network/NetworkProvider';

import { notificationKeys } from './keys';
import { notificationService } from './service';
import { UNREAD_POLL_INTERVAL_MS, unreadPollInterval } from './unread';

/**
 * Is the app in front of the patient right now?
 *
 * `SessionProvider` and `PhiPrivacyShield` each own their own `AppState`
 * subscription rather than sharing one, and this follows them: the three
 * care about different transitions (`PhiPrivacyShield` treats `inactive`
 * as obscuring, this does not care, `SessionProvider` measures how long
 * the app was away), and a shared abstraction would have to serve all
 * three badly.
 *
 * `inactive` counts as foreground here on purpose. It is the state during
 * a control-centre swipe or an incoming call banner, it lasts a moment,
 * and stopping and restarting a fifteen-second poll around it costs a
 * request rather than saving one.
 */
export function useIsForeground(): boolean {
  const [foreground, setForeground] = useState(() => AppState.currentState !== 'background');

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      setForeground(next !== 'background');
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);

  return foreground;
}

export interface UnreadCount {
  /** `undefined` until the server has answered, and after a failure. */
  readonly count: number | undefined;
}

/**
 * The unread notification count behind the tab-bar badge — O-02, F-07.
 *
 * ── Why this is a separate query from the feed ───────────────────────
 * `notificationService.unreadCount()` reads `GET /notifications/badge-counts`,
 * which counts every unread unarchived row. The feed is one page of
 * twenty, so a `filter` over it under-reports the badge the moment a
 * patient has more than a page — which is exactly when a badge matters.
 *
 * ── The poll is foreground-only, and stops when the radio is down ────
 * `refetchInterval` is `false` in the background (there is nobody to show
 * a badge to) and `false` while offline (a poll that cannot reach the
 * server is a retry loop with a fifteen-second delay). Coming back
 * online is already handled: `refetchOnReconnect` is on by default in
 * `createQueryClient`.
 *
 * ── It fails quiet ───────────────────────────────────────────────────
 * Nothing here surfaces an error. A failed count leaves `data` undefined
 * and `formatUnreadBadge` renders no badge — there is no action a patient
 * could take about a badge that would not load, and an error state on a
 * tab bar has nowhere to go. The feed screen still reports its own
 * failures normally.
 */
export function useUnreadCount(): UnreadCount {
  const isForeground = useIsForeground();
  const { isOnline } = useNetworkStatus();

  const query = useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationService.unreadCount(),
    refetchInterval: unreadPollInterval({ isForeground, isOnline }),
    // The badge is the one place staleness shows immediately, and the
    // poll interval is already the freshness contract.
    staleTime: UNREAD_POLL_INTERVAL_MS,
  });

  return { count: query.data };
}
