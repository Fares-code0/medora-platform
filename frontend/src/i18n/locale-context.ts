import { createContext, useContext } from 'react';

import { DEFAULT_LOCALE, LOCALES, type Direction, type Locale, type LocaleMeta } from './locales';

/**
 * The locale context and its readers, kept out of `LocaleProvider.tsx`.
 *
 * Not an arbitrary split: a file that exports both a component and other
 * bindings breaks Fast Refresh, and the repo's lint baseline treats each one
 * as a warning to be paid for. The provider file therefore exports the
 * provider and nothing else.
 */

export interface LocaleContextValue {
  readonly locale: Locale;
  readonly dir: Direction;
  readonly setLocale: (locale: Locale) => void;
  readonly locales: readonly LocaleMeta[];
}

/**
 * The context defaults to English rather than to `null`.
 *
 * A throwing `useLocale()` would be the stricter choice, and it is the wrong
 * one here. `useT()` is called by shared components — `Pagination`,
 * `Alert`, `Modal` — that hundreds of tests and every Storybook story mount
 * on their own, and making each of those wrap a provider buys nothing: the
 * app root mounts `LocaleProvider` unconditionally, so "no provider" is not
 * a state a user can reach. What a throw would actually do is make adding
 * one translated string to a shared component break unrelated test files,
 * which is how `t()` stops being used.
 *
 * `setLocale` is a no-op in the default: a tree with no provider has nowhere
 * to put the choice, and silently doing nothing is better than writing a
 * preference the UI will not reflect.
 */
const DEFAULT_CONTEXT: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  dir: 'ltr',
  setLocale: () => undefined,
  locales: LOCALES,
};

export const LocaleContext = createContext<LocaleContextValue>(DEFAULT_CONTEXT);

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/**
 * The reading direction, for the few cases logical CSS cannot express — a
 * directional icon, a chart axis, a swipe gesture. Reach for a logical
 * property first; this is the exception, not the tool.
 */
export function useDirection(): Direction {
  return useLocale().dir;
}

/** `true` when the document reads right-to-left. */
export function useIsRtl(): boolean {
  return useLocale().dir === 'rtl';
}
