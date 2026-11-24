import { useMatches } from 'react-router-dom';

import { useT, type MessageKey, type TranslateFn } from '@/i18n';

import type { RouteHandle } from './navigation';

/**
 * A route's display name: `handle.titleKey` run through the catalogue, or the
 * literal `handle.crumb` for a route that has not moved to a key yet. `null`
 * when the route is unnamed.
 *
 * Every shell route — doctor, administrator, reception, auth — now names
 * itself with a `titleKey` (Arabic localization, foundation phase), so the
 * document title, the route announcer and the breadcrumb all speak the active
 * language. `crumb` stays as the fallback contract for a route declared
 * outside the catalogue (tests, a feature mid-migration).
 */
export function routeName(handle: RouteHandle | undefined, t: TranslateFn): string | null {
  const key = handle?.titleKey;
  if (typeof key === 'string' && key.trim() !== '') return t(key as MessageKey);
  const crumb = handle?.crumb;
  if (typeof crumb === 'string' && crumb.trim() !== '') return crumb;
  return null;
}

/**
 * The active page's name, translated, from the same handle contract the
 * breadcrumb consumes (FRONTEND_ARCHITECTURE.md §4). Returns the deepest named
 * route on the matched chain so a detail route wins over its list route, and
 * `null` when nothing on the chain is named.
 */
export function useRouteTitle(): string | null {
  const matches = useMatches();
  const t = useT();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const name = routeName(matches[index]?.handle as RouteHandle | undefined, t);
    if (name !== null) return name;
  }

  return null;
}

/**
 * The auth branch's name for `useRouteTitle`, kept so its call site reads as
 * before. The two were separate while only auth routes carried keys; they are
 * the same lookup now.
 */
export const useTranslatedRouteTitle = useRouteTitle;
