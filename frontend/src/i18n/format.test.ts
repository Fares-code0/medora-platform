import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatDateWith,
  formatLocale,
  formatNumber,
  formatTime,
  setFormatLocale,
  THOUSANDS_SEPARATOR,
} from './format';
import { LOCALE_CODES, type Locale } from './locales';
import { loadAllCatalogues, type Messages } from './messages';

/**
 * DEC-009 — Latin digits in every language. The words follow the app's
 * language; the digits never do; the calendar and the decimal separator are
 * not changed here (each is its own decision).
 */

/** Arabic-Indic (U+0660–0669) and Extended Arabic-Indic / Persian (U+06F0–06F9). */
const NATIVE_DIGIT = /[٠-٩۰-۹]/;

/** 12 March 2026, 14:30, local time. */
const MOMENT = new Date(2026, 2, 12, 14, 30);

afterEach(() => {
  setFormatLocale('en');
});

describe.each(LOCALE_CODES)('%s', (locale: Locale) => {
  const outputs = () => [
    formatDate(MOMENT, locale),
    formatTime(MOMENT, locale),
    formatDateTime(MOMENT, locale),
    formatDateWith(MOMENT, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, locale),
    formatDateWith(MOMENT, { weekday: 'short' }, locale),
    formatDateWith(MOMENT, { month: 'short', year: '2-digit' }, locale),
    formatDateWith(MOMENT, { hour: '2-digit', minute: '2-digit' }, locale),
    formatNumber(1234.5),
    formatNumber(97.25, { maximumFractionDigits: 1 }),
  ];

  it('never shows a native digit', () => {
    for (const text of outputs()) {
      expect(text, text).not.toMatch(NATIVE_DIGIT);
    }
  });

  it('shows the Gregorian date and the 24-hour time in Latin digits', () => {
    expect(formatDate(MOMENT, locale)).toContain('12');
    expect(formatDate(MOMENT, locale)).toContain('2026');
    expect(formatTime(MOMENT, locale)).toBe('14:30');
    expect(formatDateTime(MOMENT, locale)).toContain('14:30');
  });

  it('uses a dot decimal and thin-space thousands (DEC-011)', () => {
    setFormatLocale(locale);
    expect(formatNumber(1234.5)).toBe(`1${THOUSANDS_SEPARATOR}234.5`);
    expect(formatNumber(12345)).toBe(`12${THOUSANDS_SEPARATOR}345`);
    expect(formatNumber(0.75)).toBe('0.75');
    expect(formatNumber(2.5)).toBe('2.5');
  });
});

describe('the words follow the language', () => {
  it('names the month in each language', () => {
    const month = (locale: Locale) => formatDateWith(MOMENT, { month: 'long' }, locale);
    expect(month('en')).toBe('March');
    expect(month('fr')).toBe('mars');
    expect(month('tr')).toBe('Mart');
    expect(month('ar')).toBe('مارس');
    expect(month('fa')).toBe('مارس');
  });

  it('is what bare Intl would get wrong: native digits and, for Persian, another calendar', () => {
    // The reason the module exists. If these ever stop holding, the guard
    // above still does; this only proves it is guarding something.
    const raw = new Intl.DateTimeFormat('fa', { year: 'numeric' }).format(MOMENT);
    expect(raw).toMatch(NATIVE_DIGIT);
    expect(formatDateWith(MOMENT, { year: 'numeric' }, 'fa')).toBe('2026');
  });

  it('formats in the active language when none is passed', () => {
    setFormatLocale('fr');
    expect(formatLocale()).toBe('fr');
    expect(formatDateWith(MOMENT, { month: 'long' })).toBe('mars');
  });
});

describe('catalogues', () => {
  // Loaded on demand in the app (NEW-21).
  let catalogues: Record<Locale, Messages>;
  beforeAll(async () => {
    catalogues = await loadAllCatalogues();
  });

  it.each(LOCALE_CODES)('%s has no native digit in any message', (locale) => {
    const offenders = Object.entries(catalogues[locale]).filter(([, text]) =>
      NATIVE_DIGIT.test(text),
    );
    expect(offenders).toEqual([]);
  });
});

describe('one formatting module', () => {
  const SRC = resolve(process.cwd(), 'src');
  // Formatting outside `i18n/format.ts` would bypass the Latin-digit rule.
  const DIRECT = /\btoLocale(?:Date|Time)?String\(|new Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)\(|Intl\.DateTimeFormat\((?!\)\.resolvedOptions)/;

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it('is the only place in src/ that calls Intl or toLocale*String to format', () => {
    const offenders = walk(SRC)
      .filter((path) => !path.endsWith(join('i18n', 'format.ts')))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((line, index) =>
            DIRECT.test(line) ? [`${relative(SRC, path)}:${String(index + 1)}`] : [],
          ),
      );
    expect(offenders).toEqual([]);
  });
});

describe('DEC-011 — separators of the shared number formatter', () => {
  const NNBSP = '\u202F';
  const VALUES = [0, 0.75, 2.5, 999, 1000, 1234.5, 12345, 1234567.891, -98765.4];

  it('groups thousands with U+202F NARROW NO-BREAK SPACE', () => {
    expect(THOUSANDS_SEPARATOR).toBe(NNBSP);
    expect(formatNumber(1234567.891)).toBe(`1${NNBSP}234${NNBSP}567.891`);
    expect(formatNumber(-98765.4)).toBe(`-98${NNBSP}765.4`);
    expect(formatNumber(999)).toBe('999');
  });

  it.each(LOCALE_CODES)('never shows a comma in %s', (locale) => {
    setFormatLocale(locale);
    for (const value of VALUES) {
      expect(formatNumber(value)).not.toContain(',');
      expect(formatNumber(value, { maximumFractionDigits: 1 })).not.toContain(',');
    }
  });

  it('keeps the decimal a dot and the options’ meaning', () => {
    expect(formatNumber(1234.56, { maximumFractionDigits: 1 })).toBe(`1${NNBSP}234.6`);
    expect(formatNumber(16.666, { maximumFractionDigits: 1 })).toBe('16.7');
    expect(formatNumber(0.123, { style: 'percent', maximumFractionDigits: 1 })).toBe('12.3%');
    expect(formatNumber(2.5, { minimumFractionDigits: 2 })).toBe('2.50');
  });
});
