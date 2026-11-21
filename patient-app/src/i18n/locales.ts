/**
 * The locales this client ships — checklist C-09.
 *
 * Two: English and Arabic. `frontend/` ships five (F-19), and this tree
 * starts with the pair that the row actually asks for — "English
 * complete; Arabic mirrors layout" — because a locale with no reviewed
 * translations is not a shipped locale, it is a placeholder that reads
 * as one.
 *
 * `Locale` is a **union, not `string`**. A typo in a stored preference or
 * a hand-written code is then a compile error rather than a runtime
 * fallback, and a catalogue that omits a language does not typecheck.
 * That is the whole reason this is a union in `frontend/src/i18n` too.
 */

export const LOCALE_CODES = ['en', 'ar'] as const;

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
 * Ordered as a switcher would show them: the default first. The label is
 * the endonym because that is what a speaker looks for in a language list
 * — "العربية", not "Arabic" — and the English name is carried alongside
 * rather than instead, for a screen reader running in English.
 */
export const LOCALES: readonly LocaleMeta[] = [
  { code: 'en', label: 'English', englishName: 'English', dir: 'ltr' },
  { code: 'ar', label: 'العربية', englishName: 'Arabic', dir: 'rtl' },
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
