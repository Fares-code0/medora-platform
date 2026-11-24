import { Fragment, createElement, useCallback } from 'react';
import type { ReactNode } from 'react';

import { useLocale } from './locale-context';
import type { Locale } from './locales';
import { messageFor, type MessageKey, type PluralCategory, type PluralForms } from './messages';

/** Values substituted into `{placeholder}` slots. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Values for a rich message: anything React can render, so a sentence can
 * carry a link, a `<strong>` name or a badge in the middle of it without being
 * cut into pieces a translator cannot reorder.
 */
export type RichMessageParams = Readonly<Record<string, ReactNode>>;

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

/**
 * `interpolate` for React nodes: splits the template at its placeholders and
 * slots each value in, so a translated sentence can hold elements in whatever
 * order the language needs —
 *
 * ```tsx
 * // en: "Suspending {name} cancels {count} appointments."
 * // ar: "سيؤدي إيقاف {name} إلى إلغاء {count} مواعيد."
 * tx('admin.suspend.impact', { name: <strong>{doctor.name}</strong>, count })
 * ```
 *
 * Returns a plain string when every value is a string or a number, so a rich
 * call with no elements renders exactly what `interpolate` would. Missing
 * values stay visible as `{name}`, as there.
 */
export function interpolateNodes(template: string, params: RichMessageParams): ReactNode {
  const parts = template.split(/\{(\w+)\}/);
  const nodes: ReactNode[] = [];
  // The same sequence as text, kept while every value is a primitive.
  let text: string | null = '';
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      if (part !== '') nodes.push(part);
      if (text !== null) text += part;
      return;
    }
    const value = params[part];
    if (value === undefined) {
      nodes.push(`{${part}}`);
      if (text !== null) text += `{${part}}`;
      return;
    }
    nodes.push(value);
    if (text === null) return;
    text = typeof value === 'string' || typeof value === 'number' ? text + String(value) : null;
  });
  if (text !== null) return text;
  // Spread as children rather than passed as an array, so React treats them as
  // static siblings and asks for no keys.
  return createElement(Fragment, null, ...nodes);
}

const pluralRulesCache = new Map<Locale, Intl.PluralRules>();

function pluralRules(locale: Locale): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/**
 * The form of a plural message for `count`, by `locale`'s CLDR rules.
 *
 * Arabic selects among six categories (0 → zero, 1 → one, 2 → two, 3–10 →
 * few, 11–99 → many, 100 → other); English among two. A category the
 * catalogue does not supply falls back to `other`, which every plural message
 * has. A missing or non-numeric count also takes `other` — the form that reads
 * least wrong when the number is not known.
 */
export function selectPluralForm(locale: Locale, forms: PluralForms, count: unknown): string {
  if (typeof count !== 'number' || !Number.isFinite(count)) return forms.other;
  const category: PluralCategory = pluralRules(locale).select(count);
  return forms[category] ?? forms.other;
}

/**
 * The template for `key` in `locale` — before interpolation — with English
 * standing in for a key a partial catalogue lacks (see `messageFor`), and the
 * plural form already chosen from `params.count`. An unknown key returns the
 * key itself, which only an untyped caller can reach.
 */
export function resolveMessage(
  locale: Locale,
  key: string,
  params?: Readonly<Record<string, unknown>>,
): string {
  const found = messageFor(locale, key);
  if (found === undefined) return key;
  const { message } = found;
  if (typeof message === 'string') return message;
  return selectPluralForm(found.locale, message, params?.count);
}

/** `t` without a hook: for code that already knows the locale. */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  return interpolate(resolveMessage(locale, key, params), params);
}

/** Is `value` a key of the English catalogue? */
export function isMessageKey(value: string): value is MessageKey {
  return messageFor('en', value) !== undefined;
}

/**
 * Translate a message that may be a catalogue key or already-final text.
 *
 * For validation messages: a zod schema is module-level and cannot call a
 * hook, so the schemas carry *keys* (`z.string().min(1, 'validation.enterEmail')`)
 * and the form translates them where it renders the error. A message that is
 * not a key — a server's field error, say — passes through unchanged.
 *
 * `params` fill a key's placeholders (`validation.passwordLength` needs
 * `{ count }`); they are ignored by a message that is not a key.
 */
export function translateIfKey(
  t: TranslateFn,
  message: string | undefined,
  params?: MessageParams,
): string | undefined {
  if (message === undefined) return undefined;
  return isMessageKey(message) ? t(message, params) : message;
}

export type TranslateFn = (key: MessageKey, params?: MessageParams) => string;

export type RichTranslateFn = (key: MessageKey, params: RichMessageParams) => ReactNode;

/**
 * The translation hook.
 *
 * Arabic is total — typed `Messages` against English — so an Arabic user
 * never meets an English string the catalogue knows about. French, Persian and
 * Turkish are partial (owner decision, 2026-11-23, reversing F-19's
 * "every catalogue is total"): a key they have not translated yet renders in
 * English rather than holding a string back from Arabic until all four
 * languages have it. That fallback is resolved per key in `messageFor`; the
 * provider still selects a language only once its catalogue has loaded
 * (NEW-21).
 *
 * Plurals: a key whose English value is `{ one, other }` is a plural message,
 * and `t(key, { count })` picks the form by the language's CLDR rules — all
 * six of them in Arabic. See `src/i18n/README.md`.
 */
export function useT(): TranslateFn {
  const { locale } = useLocale();

  return useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  );
}

/**
 * The rich translation hook: like `useT`, but the values may be React nodes
 * and the result is a node. For a sentence that wraps an element — a bold
 * name, a link, a count badge — which `t` would otherwise force a component to
 * split into separately translated fragments.
 */
export function useTx(): RichTranslateFn {
  const { locale } = useLocale();

  return useCallback(
    (key: MessageKey, params: RichMessageParams) =>
      interpolateNodes(resolveMessage(locale, key, params), params),
    [locale],
  );
}
