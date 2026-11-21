import { createContext, useContext } from 'react';

/**
 * Shell search seam — the navbar's GlobalSearch renders results without
 * knowing any domain, the same way `badge-context` handles counts
 * (§1.2: layouts must not import features). The APP layer provides the
 * matcher from whichever feature owns the current role's index.
 *
 * With no provider mounted the field stays a plain input. Both shells now
 * mount one — admin since Phase B, doctor as of D-26.
 */

export interface ShellSearchResult {
  readonly id: string;
  /** Primary line — the thing itself. */
  readonly label: string;
  /** Secondary line — what kind of thing it is, and where it lives. */
  readonly hint: string;
  /** Absolute path to navigate to on selection. */
  readonly path: string;
}

export interface ShellSearchValue {
  /** Returns matches for a raw term; an empty term must return no results. */
  readonly search: (term: string) => readonly ShellSearchResult[];
  /**
   * True while the sources behind the index are still loading.
   *
   * Without it an index cannot tell the panel apart from a finished search
   * that found nothing, and the panel says "No matches for Khaled" about a
   * patient the app is in the middle of fetching — a confident false
   * answer, which is the defect class D-04 and D-16 were filed for. An
   * index whose sources are all synchronous simply omits it.
   */
  readonly pending?: boolean;
  /**
   * Called the first time the user engages the field (focus or typing).
   *
   * A provider whose index is already in memory ignores this — the admin
   * one does, because its store is local. The doctor's index spans five
   * feature datasets behind mock services, and subscribing to them on every
   * doctor page load would spend five round trips on a field most page
   * views never touch. So the index stays unsubscribed until this fires.
   *
   * Ported from the parallel D-26 implementation in #63, which measured the
   * cost and designed this seam for it.
   */
  readonly onActivate?: (() => void) | undefined;
}

const DEFAULT_VALUE: ShellSearchValue = { search: () => [] };

export const ShellSearchContext = createContext<ShellSearchValue>(DEFAULT_VALUE);

export function useShellSearch(): ShellSearchValue {
  return useContext(ShellSearchContext);
}
