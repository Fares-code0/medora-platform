import { useCallback, useState } from 'react';

import { useAuth } from '@/app/providers';
import { getPreference, setPreference, type DashboardSelectionKey } from '@/services/preferences';

/**
 * A user's widget selection on a customizable dashboard: which widgets are on
 * their Overview, in the order they were added. The only place a dashboard
 * knows storage exists. Each role's Overview binds it to its own preference
 * key and its own catalogue's id guard.
 *
 * Empty by default. The Overview is something the user composes, so a first
 * visit shows nothing but the invitation to compose it.
 *
 * Reads are not trusted wholesale. Anything that is not an array yields the
 * empty default (getPreference already returns null for corrupt JSON), an id
 * this build no longer ships is dropped rather than rendered as a hole, and a
 * duplicate collapses to its first position — so a value written by an older
 * or newer build still produces a valid selection.
 *
 * Namespaced per user through `user?.id`, so one account never reads
 * another's selection. It survives logout (`clearUserPreferences` keeps it),
 * a refresh and a browser restart, and a returning user's Overview opens on
 * the widgets they left. The read is synchronous and storage is written only
 * by a user's own change, so the empty default shown before anything is read
 * can never overwrite a saved selection. Persistence is this browser only;
 * following a user across devices needs a server-side preference, which does
 * not exist yet.
 */
function sanitize<TId extends string>(
  stored: unknown,
  isId: (value: unknown) => value is TId,
): readonly TId[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<TId>();
  for (const value of stored as readonly unknown[]) {
    if (isId(value)) seen.add(value);
  }
  return [...seen];
}

export interface DashboardWidgetSelection<TId extends string> {
  /** Active widgets, in display order. */
  readonly activeIds: readonly TId[];
  readonly isActive: (id: TId) => boolean;
  /** Appends to the end — a new widget lands last, nothing else moves. */
  readonly add: (id: TId) => void;
  readonly remove: (id: TId) => void;
  /** Puts a removed widget back where it was (the Undo on a removal). */
  readonly restore: (id: TId, index: number) => void;
  readonly clear: () => void;
  /**
   * Replaces the whole selection at once — the customize drawer's Done.
   * The ids are sanitised like a read (unknown ids dropped, duplicates
   * collapsed, order kept) and written to storage before the dashboard
   * re-renders from them. Returns whether the write reached storage, so a
   * failed save is never reported as a saved one.
   */
  readonly replace: (ids: readonly TId[]) => boolean;
}

export function useDashboardWidgetSelection<TId extends string>(
  key: DashboardSelectionKey,
  isId: (value: unknown) => value is TId,
): DashboardWidgetSelection<TId> {
  const { user } = useAuth();
  const userId = user?.id;

  /*
   * Keyed on the user, and re-read when the user changes, rather than read
   * once on mount. The Overview mounts behind the auth guard so the user is
   * normally known by then, but if it were ever rendered during the boot
   * restore, a mount-only read would pin the anonymous slot's (empty) value
   * for the whole visit. Adjusting state during render is React's documented
   * pattern for this and costs no extra commit.
   */
  const [state, setState] = useState(() => ({
    userId,
    ids: sanitize(getPreference(key, userId), isId),
  }));
  if (state.userId !== userId) {
    setState({ userId, ids: sanitize(getPreference(key, userId), isId) });
  }

  const update = useCallback(
    (change: (previous: readonly TId[]) => readonly TId[]) => {
      setState((previous) => {
        const ids = change(previous.ids);
        if (ids === previous.ids) return previous;
        setPreference(key, ids, previous.userId);
        return { ...previous, ids };
      });
    },
    [key],
  );

  const add = useCallback(
    (id: TId) => {
      update((ids) => (ids.includes(id) ? ids : [...ids, id]));
    },
    [update],
  );

  const remove = useCallback(
    (id: TId) => {
      update((ids) => (ids.includes(id) ? ids.filter((entry) => entry !== id) : ids));
    },
    [update],
  );

  const restore = useCallback(
    (id: TId, index: number) => {
      update((ids) => {
        if (ids.includes(id)) return ids;
        const at = Math.min(Math.max(index, 0), ids.length);
        return [...ids.slice(0, at), id, ...ids.slice(at)];
      });
    },
    [update],
  );

  const clear = useCallback(() => {
    update((ids) => (ids.length === 0 ? ids : []));
  }, [update]);

  const replace = useCallback(
    (ids: readonly TId[]): boolean => {
      // A fresh array, so the committed selection never aliases the caller's.
      const next = sanitize(ids, isId);
      const saved = setPreference(key, next, userId);
      setState((previous) => ({ ...previous, ids: next }));
      return saved;
    },
    [isId, key, userId],
  );

  const activeIds = state.ids;
  const isActive = useCallback((id: TId) => activeIds.includes(id), [activeIds]);

  return { activeIds, isActive, add, remove, restore, clear, replace };
}
