/**
 * The locales Medora ships (F-19).
 *
 * Five, chosen by product: English, Arabic, Turkish, Persian and French.
 * Two of them are right-to-left, which is the reason this row was called a
 * cross-cutting rewrite rather than a translation pass — direction is a
 * document-level property, not a string.
 *
 * `Locale` is a **union**, not `string`. The old auth-local type was
 * `type Locale = string`, which meant a typo in a stored preference or a
 * hand-written locale code was a runtime fallback rather than a compile
 * error, and a catalogue could silently omit a language. With the union, a
 * message catalogue that is missing a locale does not typecheck.
 */

export const LOCALE_CODES = ['en', 'ar', 'tr', 'fa', 'fr'] as const;

export type Locale = (typeof LOCALE_CODES)[number];

export type Direction = 'ltr' | 'rtl';

export interface LocaleMeta {
  readonly code: Locale;
  /** The endonym — how speakers write the language's own name. */
  readonly label: string;
  /** The English name, for a screen reader announcing the switcher in English. */
  readonly englishName: string;
  readonly dir: Direction;
}

/**
 * Ordered as the switcher shows them: the default first, then the rest
 * alphabetically by English name. Endonyms are what a speaker looks for in a
 * language list — "العربية", not "Arabic" — which is why the label is the
 * endonym and the English name is carried separately rather than instead.
 */
export const LOCALES: readonly LocaleMeta[] = [
  { code: 'en', label: 'English', englishName: 'English', dir: 'ltr' },
  { code: 'ar', label: 'العربية', englishName: 'Arabic', dir: 'rtl' },
  { code: 'fr', label: 'Français', englishName: 'French', dir: 'ltr' },
  { code: 'fa', label: 'فارسی', englishName: 'Persian', dir: 'rtl' },
  { code: 'tr', label: 'Türkçe', englishName: 'Turkish', dir: 'ltr' },
];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALE_CODES as readonly string[]).includes(value);
}

export function localeMeta(locale: Locale): LocaleMeta {
  // Total by construction: `LOCALES` covers the union, asserted in tests.
  return LOCALES.find((entry) => entry.code === locale) ?? LOCALES[0]!;
}

export function directionOf(locale: Locale): Direction {
  return localeMeta(locale).dir;
}
