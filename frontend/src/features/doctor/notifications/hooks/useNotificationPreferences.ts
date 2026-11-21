import { useCallback, useMemo, useRef } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth, useToast } from '@/app/providers';

import { notificationKeys } from '../api/useNotificationsQuery';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '../model/types';

/**
 * Notification preferences — delivery channels, quiet hours and category
 * opt-ins — through the notifications port: the demo keeps them per user in
 * this browser, the API under `/me/notification-preferences` (API §10.5).
 *
 * **Each switch applies at once and is optimistic, with rollback** (DP-05's
 * rule: a failure here costs a switch flipping back, never a false clinical
 * claim). Every change writes the **whole** document, computed from the
 * latest value on screen, and the writes run one after another
 * (`scope`), so a later document can never land before an earlier one.
 * Only the newest write decides what the screen shows: an older answer
 * arriving late does not flick a switch back. A refused write restores the
 * value the newest change replaced and says so — it is never silent.
 */

type PreferencesStatus = 'loading' | 'error' | 'ready';

interface SaveInput {
  readonly next: NotificationPreferences;
  readonly previous: NotificationPreferences;
  /** Which change this is; only the newest reconciles the cache. */
  readonly ticket: number;
}

const service = () => import('../service').then((module) => module.notificationService);

export interface UseNotificationPreferencesOptions {
  /** Fetch only while the surface that shows them is open. Defaults to true. */
  readonly enabled?: boolean;
}

export function useNotificationPreferences({
  enabled = true,
}: UseNotificationPreferencesOptions = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const latest = useRef(0);

  const queryKey = useMemo(
    () => [...notificationKeys.all, 'preferences', userId] as const,
    [userId],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => service().then((notifications) => notifications.fetchPreferences(userId)),
    staleTime: 60_000,
    enabled,
  });

  const { mutate } = useMutation({
    scope: { id: `notification-preferences:${userId}` },
    mutationFn: (input: SaveInput) =>
      service().then((notifications) => notifications.savePreferences(userId, input.next)),
    onSuccess: (stored, input) => {
      if (input.ticket === latest.current) queryClient.setQueryData(queryKey, stored);
    },
    onError: (_error, input) => {
      if (input.ticket === latest.current) {
        queryClient.setQueryData(queryKey, input.previous);
        // `previous` may itself hold an earlier change that also failed, so
        // the server's own document has the last word.
        void queryClient.invalidateQueries({ queryKey });
      }
      toast({
        variant: 'error',
        title: 'Could not save notification preferences',
        description: 'That change was not kept. Your previous setting is shown.',
      });
    },
  });

  const update = useCallback(
    (change: (previous: NotificationPreferences) => NotificationPreferences) => {
      const previous = queryClient.getQueryData<NotificationPreferences>(queryKey);
      // Nothing loaded means nothing on screen to change.
      if (previous === undefined) return;
      const next = change(previous);
      latest.current += 1;
      // A refetch in flight would otherwise land on top of the change.
      void queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, next);
      mutate({ next, previous, ticket: latest.current });
    },
    [queryClient, mutate, queryKey],
  );

  const reset = useCallback(() => update(() => DEFAULT_NOTIFICATION_PREFERENCES), [update]);

  const status: PreferencesStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready';

  return {
    preferences: query.data,
    status,
    error: query.error,
    retry: () => void query.refetch(),
    update,
    reset,
  } as const;
}
