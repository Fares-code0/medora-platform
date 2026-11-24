import type { Locale } from '../locales';

import { en, type Messages, type PartialMessages } from './en';

export type {
  MessageKey,
  Messages,
  PartialMessages,
  PluralCategory,
  PluralForms,
  PluralMessageKey,
} from './en';

/**
 * Every catalogue, keyed by locale — and loaded on demand (NEW-21).
 *
 * `Record<Locale, …>` keeps the locale set total: a new locale added to the
 * union without a loader fails here. The catalogues themselves are no longer
 * all total (owner decision, 2026-11-23): Arabic is typed `Messages`, so a key
 * added to `en` without its Arabic fails to compile in `ar.ts`; French,
 * Persian and Turkish are `PartialMessages` and fall back to English key by
 * key at lookup (`messageFor`). See `src/i18n/README.md`.
 *
 * What changed with NEW-21 is when they arrive. All five used to load on
 * every visit, though one language is active at a time; the four that are not
 * English are now their own chunks. English stays eager: it is the default
 * and the fallback. `main.tsx` loads a returning user's stored language before
 * the first render, so nobody sees English flash and the page flip from
 * left-to-right to right-to-left; a switch at runtime keeps the current
 * language on screen until the new one has arrived.
 */
const LOADERS: Record<Locale, () => Promise<PartialMessages>> = {
  en: () => Promise.resolve(en),
  ar: () => import('./ar').then((module) => module.ar),
  fr: () => import('./fr').then((module) => module.fr),
  fa: () => import('./fa').then((module) => module.fa),
  tr: () => import('./tr').then((module) => module.tr),
};

const loaded = new Map<Locale, PartialMessages>([['en', en]]);
const inFlight = new Map<Locale, Promise<PartialMessages>>();

export function isCatalogueLoaded(locale: Locale): boolean {
  return loaded.has(locale);
}

/**
 * The catalogue for `locale` if it has loaded, else English. Callers only
 * select a locale once its catalogue is in (see `LocaleProvider`), so the
 * fallback is for a locale reached some other way — never a path a user's
 * choice takes.
 */
export function catalogueFor(locale: Locale): PartialMessages {
  return loaded.get(locale) ?? en;
}

/** Loads (once) and caches a catalogue; a failed load can be retried. */
export function loadCatalogue(locale: Locale): Promise<PartialMessages> {
  const ready = loaded.get(locale);
  if (ready !== undefined) return Promise.resolve(ready);
  const pending = inFlight.get(locale);
  if (pending !== undefined) return pending;
  const request = LOADERS[locale]()
    .then((messages) => {
      loaded.set(locale, messages);
      return messages;
    })
    .finally(() => inFlight.delete(locale));
  inFlight.set(locale, request);
  return request;
}

/** Every catalogue at once — for the consistency tests, which read them all. */
export async function loadAllCatalogues(): Promise<Record<Locale, PartialMessages>> {
  const locales = Object.keys(LOADERS) as Locale[];
  const entries = await Promise.all(
    locales.map(async (locale) => [locale, await loadCatalogue(locale)] as const),
  );
  return Object.fromEntries(entries) as Record<Locale, PartialMessages>;
}

/** A catalogue value: a plain string, or plural forms. */
export type MessageValue = Messages[keyof Messages];

/**
 * The message for `key` in `locale`, and the locale it actually came from.
 *
 * A partial catalogue (fr, fa, tr) that lacks the key yields English — and
 * says so, because a plural form has to be chosen by *English* rules for an
 * English sentence: French puts 0 in `one`, and "0 result" is not English.
 * `undefined` only for a key no catalogue has, which typed code cannot reach.
 */
export function messageFor(
  locale: Locale,
  key: string,
): { readonly message: MessageValue; readonly locale: Locale } | undefined {
  // `Object.hasOwn`, not a bare index: `en['constructor']` is a function, and
  // a server message that happens to be `'toString'` must not read as a key.
  const catalogue = catalogueFor(locale) as Readonly<Record<string, MessageValue>>;
  if (Object.hasOwn(catalogue, key)) return { message: catalogue[key] as MessageValue, locale };
  const english = en as Readonly<Record<string, MessageValue>>;
  return Object.hasOwn(english, key)
    ? { message: english[key] as MessageValue, locale: 'en' }
    : undefined;
}
