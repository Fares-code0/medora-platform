import { useMemo } from 'react';

import {
  formatDate,
  formatDateTime,
  formatLongDate,
  formatRelative,
  formatTime,
} from '@/utils/datetime';

import { useLocale } from './LocaleProvider';

/**
 * The date formatters, bound to the language the patient chose.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * `utils/datetime.ts` passed `undefined` to `Intl` until 2026-09-12,
 * which resolves the **device's** locale. This app has its own, and a
 * patient can set Medora to Arabic on an English phone — so every record
 * date, every appointment time and every "tomorrow" stayed in English
 * on a screen whose headings had just been translated.
 *
 * The functions now take the locale, which makes it impossible to forget
 * and tedious to remember. This is where it is remembered once. A screen
 * writes
 *
 * ```tsx
 * const { formatDateTime } = useDateFormat();
 * ```
 *
 * and calls it exactly as before.
 *
 * ── What it is NOT ──────────────────────────────────────────────────
 *
 * It is not a timezone. The device's zone still applies and the gap is
 * still A-08's — see the note at the top of `utils/datetime.ts` and the
 * scan at the bottom of `datetime.test.ts`. Choosing a language does not
 * move a clinic.
 */
/**
 * `timeZone` is the server's own IANA name where the payload carries one
 * — today only `clinicTimezone`, on an appointment. Omitted, the
 * device's zone applies, which is what everything without a zone in its
 * contract has always done. Nothing here invents one.
 */
export interface DateFormatters {
  /** "Mon 14 Sep" */
  readonly formatDate: (iso: string, timeZone?: string | null) => string;
  /** "14 September 2026" */
  readonly formatLongDate: (iso: string, timeZone?: string | null) => string;
  /** "09:30" */
  readonly formatTime: (iso: string, timeZone?: string | null) => string;
  /** "Mon 14 Sep, 09:30" */
  readonly formatDateTime: (iso: string, timeZone?: string | null) => string;
  /** "tomorrow", "in 3 days", "2 weeks ago" */
  readonly formatRelative: (
    iso: string,
    options?: { readonly now?: Date; readonly timeZone?: string | null },
  ) => string;
}

/** `null` and `undefined` both mean "no zone was supplied". */
function zone(timeZone?: string | null): { timeZone?: string } {
  return timeZone === null || timeZone === undefined ? {} : { timeZone };
}

export function useDateFormat(): DateFormatters {
  const { locale } = useLocale();

  return useMemo(
    () => ({
      formatDate: (iso: string, timeZone?: string | null) =>
        formatDate(iso, locale, zone(timeZone).timeZone),
      formatLongDate: (iso: string, timeZone?: string | null) =>
        formatLongDate(iso, locale, zone(timeZone).timeZone),
      formatTime: (iso: string, timeZone?: string | null) =>
        formatTime(iso, locale, zone(timeZone).timeZone),
      formatDateTime: (iso: string, timeZone?: string | null) =>
        formatDateTime(iso, locale, zone(timeZone).timeZone),
      formatRelative: (
        iso: string,
        options?: { readonly now?: Date; readonly timeZone?: string | null },
      ) =>
        formatRelative(iso, locale, {
          ...(options?.now === undefined ? {} : { now: options.now }),
          ...zone(options?.timeZone),
        }),
    }),
    [locale],
  );
}
