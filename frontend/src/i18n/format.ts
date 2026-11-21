import { DEFAULT_LOCALE, type Locale } from './locales';

/**
 * Dates, times and numbers for display — the one place they are formatted
 * (DEC-009). Every `Intl` formatter in the app comes from here; a direct
 * `toLocaleString()` or `new Intl.DateTimeFormat(…)` elsewhere is a defect
 * (`format.test.ts` scans `src/` for them).
 *
 * ## Latin digits, in every language
 *
 * Asked for in Arabic or Persian, `Intl` answers in native digits — ٠١٢٣ and
 * ۰۱۲۳ — by default. This is clinical software: a dose, a lab value, an MRN
 * and the date beside them must be read in ONE digit system, the one the
 * server stores and the keyboard types. So every formatter here is built
 * with `numberingSystem: 'latn'` (and the `-u-nu-latn` extension, belt and
 * braces). What the language changes is the words and their order —
 * "12 مارس 2026", "12 mars 2026" — never the digits.
 *
 * ## What DEC-009 deliberately does not change
 *
 * - **Calendar.** Persian `Intl` defaults to the Solar Hijri calendar; every
 *   date here is pinned to Gregorian (`calendar: 'gregory'`, `-u-ca-gregory`),
 *   which is what the server stores and what the app has always shown. A
 *   change is its own decision.
 * - **Separators (DEC-011).** The decimal is a dot in every language — the
 *   form clinical values, number inputs and the server all use. Thousands
 *   are grouped with U+202F NARROW NO-BREAK SPACE, the SI thin space —
 *   `1 234.5`, `12 345`, `0.75` — because a comma reads as a decimal point
 *   to French and Turkish readers, and a space reads as nothing else. It does
 *   not break across lines, and its bidi class keeps the number one run in
 *   right-to-left text. Raw clinical values are not formatted here at all.
 *
 * ## The active locale
 *
 * Most callers are plain functions — column definitions, selectors, export
 * builders — that cannot call a hook, so the locale is held here and set by
 * `LocaleProvider`. A change of language remounts the routed tree
 * (`LocaleRemount`), so nothing keeps a string formatted in the old one.
 */

const DATE_EXTENSION = '-u-ca-gregory-nu-latn';
const NUMBER_LOCALE = 'en-u-nu-latn';

/** U+202F NARROW NO-BREAK SPACE — the thousands separator (DEC-011). */
export const THOUSANDS_SEPARATOR = '\u202F';

let activeLocale: Locale = DEFAULT_LOCALE;

/** Called by `LocaleProvider`; tests may call it to render another language. */
export function setFormatLocale(locale: Locale): void {
  activeLocale = locale;
}

export function formatLocale(): Locale {
  return activeLocale;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

function dateFormatter(options: Intl.DateTimeFormatOptions, locale: Locale): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(`${locale}${DATE_EXTENSION}`, {
      ...options,
      calendar: 'gregory',
      numberingSystem: 'latn',
    });
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

type DateInput = Date | string | number;

const toDate = (value: DateInput): Date => (value instanceof Date ? value : new Date(value));

/**
 * Any date/time shape, in the active language, Latin digits, Gregorian.
 * The named helpers below are the common shapes; pass options for the rest.
 */
export function formatDateWith(
  value: DateInput,
  options: Intl.DateTimeFormatOptions,
  locale: Locale = activeLocale,
): string {
  return dateFormatter(options, locale).format(toDate(value));
}

/** "Mar 12, 2026" · "12 مارس 2026" · "12 mars 2026" */
export function formatDate(value: DateInput, locale: Locale = activeLocale): string {
  return formatDateWith(value, { day: 'numeric', month: 'short', year: 'numeric' }, locale);
}

/** "14:30" — 24-hour, the clinical convention the app already uses. */
export function formatTime(value: DateInput, locale: Locale = activeLocale): string {
  return formatDateWith(value, { hour: '2-digit', minute: '2-digit', hour12: false }, locale);
}

/**
 * An instant's civil date, weekday and time of day **in a given zone** — for
 * rules that compare against a wall clock (the clinic's working hours,
 * BR-DEC-005), not for display. Read with a fixed `en-US` formatter, so the
 * weekday is always `Mon`…`Sun` and the digits Latin, whatever the language.
 * `null` reads in the device's zone.
 */
export interface WallClock {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `Mon` … `Sun`. */
  readonly weekday: string;
  /** Minutes past midnight. */
  readonly minutes: number;
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

export function wallClockIn(value: DateInput, timeZone: string | null): WallClock {
  const key = timeZone ?? '';
  let formatter = wallClockFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US-u-nu-latn', {
      ...(timeZone === null ? {} : { timeZone }),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    wallClockFormatters.set(key, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(toDate(value)).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts['year'] ?? ''}-${parts['month'] ?? ''}-${parts['day'] ?? ''}`,
    weekday: parts['weekday'] ?? '',
    minutes: Number(parts['hour']) * 60 + Number(parts['minute']),
  };
}

/** Whether this runtime can read times in `timeZone` (an IANA name). */
export function isUsableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "Mar 12, 2026, 14:30" */
export function formatDateTime(value: DateInput, locale: Locale = activeLocale): string {
  return formatDateWith(
    value,
    {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
    locale,
  );
}

/**
 * A number with a dot decimal, thin-space thousands and Latin digits, in
 * every language: `1 234.5` (DEC-009, DEC-011). Options — fraction digits,
 * percent, currency — keep their meaning; only the group separator differs
 * from English `Intl`.
 */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const key = JSON.stringify(options);
  let formatter = numberFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(NUMBER_LOCALE, { ...options, numberingSystem: 'latn' });
    numberFormatters.set(key, formatter);
  }
  return formatter
    .formatToParts(value)
    .map((part) => (part.type === 'group' ? THOUSANDS_SEPARATOR : part.value))
    .join('');
}
