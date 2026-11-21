import type { Locale } from '../locales';

import { en, type Messages } from './en';

export type { MessageKey, Messages } from './en';

/**
 * Every catalogue, keyed by locale — and loaded on demand (NEW-21).
 *
 * `Record<Locale, …>` keeps it total in both directions, as the eager
 * `catalogues` object did: a new locale added to the union without a loader
 * fails here, and each catalogue file is typed `Messages`, so a key added to
 * `en` without its four translations fails in the file that omits it.
 * Neither can ship as a silent English fallback.
 *
 * What changed is when they arrive. All five used to load on every visit,
 * though one language is active at a time; the four that are not English are
 * now their own chunks (≈17 kB gzip together). English stays eager: it is the
 * default and the fallback. `main.tsx` loads a returning user's stored
 * language before the first render, so nobody sees English flash and the
 * page flip from left-to-right to right-to-left; a switch at runtime keeps
 * the current language on screen until the new one has arrived.
 */
const LOADERS: Record<Locale, () => Promise<Messages>> = {
  en: () => Promise.resolve(en),
  ar: () => import('./ar').then((module) => module.ar),
  fr: () => import('./fr').then((module) => module.fr),
  fa: () => import('./fa').then((module) => module.fa),
  tr: () => import('./tr').then((module) => module.tr),
};

const loaded = new Map<Locale, Messages>([['en', en]]);
const inFlight = new Map<Locale, Promise<Messages>>();

export function isCatalogueLoaded(locale: Locale): boolean {
  return loaded.has(locale);
}

/**
 * The catalogue for `locale` if it has loaded, else English. Callers only
 * select a locale once its catalogue is in (see `LocaleProvider`), so the
 * fallback is for a locale reached some other way — never a path a user's
 * choice takes.
 */
export function catalogueFor(locale: Locale): Messages {
  return loaded.get(locale) ?? en;
}

/** Loads (once) and caches a catalogue; a failed load can be retried. */
export function loadCatalogue(locale: Locale): Promise<Messages> {
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
export async function loadAllCatalogues(): Promise<Record<Locale, Messages>> {
  const locales = Object.keys(LOADERS) as Locale[];
  const entries = await Promise.all(
    locales.map(async (locale) => [locale, await loadCatalogue(locale)] as const),
  );
  return Object.fromEntries(entries) as Record<Locale, Messages>;
}
