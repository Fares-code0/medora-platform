import { createContext, useContext } from 'react';

import type { LucideIcon } from 'lucide-react';

import type { NavigationItem } from './navigation';

/**
 * Shell badge context — the §4 `badgeSource` seam without breaking the
 * layer boundary (§1.2: layouts must not import features). The shell
 * consumes this domain-free contract; the APP layer provides it from the
 * notifications feature's public TanStack Query hooks (one shared cache,
 * so a read/send anywhere updates every badge at once). Defaults keep
 * the shell rendering when no provider is mounted (e.g. admin area).
 */

/** One row of the navbar bell feed, already mapped for presentation. */
export interface ShellFeedItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly timeLabel: string;
  readonly unread: boolean;
  readonly icon: LucideIcon;
  readonly iconClass: string;
}

export interface ShellBadgesValue {
  readonly counts: Record<NonNullable<NavigationItem['badgeSource']>, number>;
  /** Recent notifications for the bell; null while loading. */
  readonly feed: readonly ShellFeedItem[] | null;
  /** Mark one feed item read (Phase 19 — the bell is no placeholder). */
  readonly markRead: (id: string) => void;
  /** Mark every unread notification read. */
  readonly markAllRead: () => void;
  /**
   * Archive (clear) every read notification; null when the notification
   * service cannot (the bell then does not offer it).
   */
  readonly clearRead: (() => void) | null;
  /** Role-aware "View all" destination; null hides the footer link. */
  readonly viewAllHref: string | null;
}

const NOOP = () => undefined;

const DEFAULT_VALUE: ShellBadgesValue = {
  // No provider, no counts: a badge is a promise of work waiting, and a
  // stand-in number would make one nobody can keep (FE-10.10).
  counts: { notifications: 0, messages: 0, pendingRequests: 0 },
  feed: [],
  markRead: NOOP,
  markAllRead: NOOP,
  clearRead: NOOP,
  viewAllHref: null,
};

export const ShellBadgesContext = createContext<ShellBadgesValue>(DEFAULT_VALUE);

export function useShellBadges(): ShellBadgesValue {
  return useContext(ShellBadgesContext);
}
