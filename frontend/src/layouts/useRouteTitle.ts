import { useMatches } from 'react-router-dom';

import { useT } from '@/i18n';
import type { MessageKey } from '@/i18n';

import type { RouteHandle } from './navigation';

/**
 * The active page's name, from the same `handle.crumb` contract the
 * breadcrumb consumes (FRONTEND_ARCHITECTURE.md §4). Returns the deepest
 * crumb on the matched chain so a detail route wins over its list route,
 * and `null` when nothing on the chain is named.
 */
export function useRouteTitle(): string | null {
  const matches = useMatches();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const crumb = (matches[index]?.handle as RouteHandle | undefined)?.crumb;
    if (typeof crumb === 'string' && crumb.trim() !== '') return crumb;
  }

  return null;
}

/**
 * The active page's name, **translated** — `handle.titleKey` run through the
 * catalogue, falling back to `handle.crumb`.
 *
 * Two mechanisms because the app has two areas with different translation
 * states. The shell's route names are literals in `navigation.ts`, along with
 * the ~2,045 other untranslated feature-interior strings; the auth branch is
 * fully translated and its titles must be too, or an Arabic sign-in page would
 * name its browser tab in English.
 *
 * Deepest match wins, as with `useRouteTitle`, so a nested page beats the
 * layout it renders inside.
 */
export function useTranslatedRouteTitle(): string | null {
  const matches = useMatches();
  const t = useT();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle as RouteHandle | undefined;
    const key = handle?.titleKey;
    if (typeof key === 'string' && key.trim() !== '') return t(key as MessageKey);
    const crumb = handle?.crumb;
    if (typeof crumb === 'string' && crumb.trim() !== '') return crumb;
  }

  return null;
}
