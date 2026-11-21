import { useCallback } from 'react';

import { useLocale } from './locale-context';
import { catalogueFor, type MessageKey } from './messages';

/** Values substituted into `{placeholder}` slots. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Substitute `{name}` placeholders.
 *
 * Deliberately not a template-literal or a format library: the catalogues
 * are typed, the placeholder set is small, and the one thing a template
 * approach would buy — arbitrary expressions in the message — is exactly
 * what a translator must never be handed.
 *
 * A placeholder with no matching parameter is **left as written** rather
 * than replaced with an empty string. "Step {step} of 4" is visibly wrong
 * and gets fixed; "Step  of 4" reads as a spacing bug and does not.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export type TranslateFn = (key: MessageKey, params?: MessageParams) => string;

/**
 * The translation hook.
 *
 * Every catalogue is total — each is a `Record<MessageKey, string>` and the
 * loader map is a `Record<Locale, …>` — so unlike the auth-local predecessor
 * there is no runtime fallback chain to reason about: if it compiles, the
 * string exists in every language, and the provider selects a language only
 * once its catalogue has loaded (NEW-21). The
 * `?? key` at the end is unreachable in typed code and exists only for a
 * catalogue reached through an untyped boundary (a test fixture, a
 * hand-written locale in storage).
 */
export function useT(): TranslateFn {
  const { locale } = useLocale();

  return useCallback(
    (key: MessageKey, params?: MessageParams) =>
      interpolate(catalogueFor(locale)[key] ?? key, params),
    [locale],
  );
}
