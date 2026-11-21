/**
 * Date and time formatting.
 *
 * ── The timezone rule (audit R-12) ───────────────────────────────────
 * The server stores UTC and returns ISO-8601 UTC. **The client formats;
 * it never computes.** A slot's local time, a "closed today", a DST
 * boundary — all of those are the clinic's timezone applied server-side.
 * Anything here that looked like arithmetic on a clinic rule would be a
 * second implementation of it, disagreeing on the last Sunday in October.
 *
 * **Formatting in the clinic's zone is the other half of that rule, and
 * it was missing until 2026-09-12.** `GET /me/appointments` returns
 * `clinicTimezone` — an IANA name — on the page and on the detail, and
 * `api/endpoints/appointments.ts` has said what to do with it since it
 * was written: *"Format with it; never compute. 'Today' is a question
 * about the clinic's zone, not the device's — a travelling patient
 * changes their device zone, not their appointment."* The schema parsed
 * it and the mapper dropped it, so a patient one zone from their clinic
 * read the wrong time for their own appointment.
 *
 * So `timeZone` is an **optional** argument here. Given, it is the
 * server's own value and these render in it. Omitted — everything that
 * is not an appointment, because no other endpoint sends a zone yet —
 * the device's applies exactly as before. This file still invents
 * nothing: there is no default zone, no guess, and no arithmetic on a
 * clinic rule.
 *
 * `Intl` is available in Hermes with the `intl` variant that Expo SDK 52
 * ships, and the formatters below degrade to a readable ISO fragment if
 * it is ever absent rather than throwing on a screen a patient is reading.
 *
 * ── Every function takes the locale, and that is the point ───────────
 *
 * They passed `undefined` to `Intl` until 2026-09-12, which resolves the
 * **device's** locale. This app has its own (C-09, P-07): a patient can
 * set Medora to Arabic on an English phone, and did — and then read
 * "14 September 2026" on every record, with "tomorrow" hard-coded in
 * English beside every appointment. The two can disagree, so the caller
 * says which one it means, and the parameter is required so no call site
 * can quietly fall back to the phone's.
 *
 * `useDateFormat()` in `src/i18n/` is what screens use; it binds these to
 * the locale the provider holds. These stay pure so a test can call them
 * with a locale and no provider.
 */

function safeDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Mon 14 Sep" */
export function formatDate(iso: string, locale: string, timeZone?: string): string {
  const date = safeDate(iso);
  if (date === null) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

/** "14 September 2026" */
export function formatLongDate(iso: string, locale: string, timeZone?: string): string {
  const date = safeDate(iso);
  if (date === null) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

/** "09:30" */
export function formatTime(iso: string, locale: string, timeZone?: string): string {
  const date = safeDate(iso);
  if (date === null) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(date);
  } catch {
    return iso.slice(11, 16);
  }
}

/** "Mon 14 Sep, 09:30" — the appointment card's line. */
export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  return `${formatDate(iso, locale, timeZone)}, ${formatTime(iso, locale, timeZone)}`;
}

/**
 * Whether a zone is the one this device is already in.
 *
 * Used to decide whether to SAY that a time is the clinic's. When the
 * two agree — which they do for most patients, most of the time — the
 * note is noise; when they do not, its absence is the defect.
 */
export function isDeviceTimeZone(timeZone: string | null): boolean {
  if (timeZone === null) return true;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone === timeZone;
  } catch {
    return true;
  }
}

/**
 * Midnight at the start of a date, in a named zone or the device's own.
 *
 * The relative hint is about CALENDAR days, not about elapsed hours, and
 * the two disagree exactly where it matters most: at 22:00, an
 * appointment at 09:00 the next morning is eleven hours away, which
 * rounds to zero — so the card used to say "today" about tomorrow. The
 * previous rule ("round rather than truncate") was written to stop the
 * opposite error and only ever half-worked, because no amount of
 * rounding turns an elapsed-time question into a calendar one.
 *
 * This is device-local arithmetic on the device's own clock, which is
 * what the hint has always been. It is not a clinic rule: the timezone
 * note above still stands, and nothing here computes a slot, an opening
 * hour or a DST boundary.
 */
function startOfLocalDay(date: Date, timeZone?: string): number {
  if (timeZone !== undefined) {
    try {
      // `en-CA` is ISO order — `2026-09-14` — which is the cheapest way
      // to ask `Intl` "what calendar date is this instant, there?".
      // Both ends of the comparison go through the same conversion, so
      // the difference is exact days in that zone.
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
      const parsed = Date.parse(`${day}T00:00:00Z`);
      if (!Number.isNaN(parsed)) return parsed;
    } catch {
      // An unknown zone name. Fall through to the device's.
    }
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * "in 3 days", "tomorrow", "2 weeks ago".
 *
 * Relative to the DEVICE clock, and used only for a human hint beside an
 * absolute time that is always also rendered. It is never the only
 * statement of when something is: a device with a wrong clock would
 * otherwise tell a patient their appointment is next week.
 *
 * `numeric: 'auto'` is what produces "today", "tomorrow" and "yesterday"
 * — in whichever language it was given. Those three were hard-coded in
 * English ahead of this call until 2026-09-12, on the argument that
 * `'auto'` is "not guaranteed to produce them in every locale". It does
 * in both of this app's, and the hard-coding guaranteed the opposite:
 * every appointment card in Arabic said "tomorrow".
 */
export function formatRelative(
  iso: string,
  locale: string,
  options: { readonly now?: Date; readonly timeZone?: string } = {},
): string {
  const date = safeDate(iso);
  if (date === null) return '';
  const now = options.now ?? new Date();
  // The hint and the absolute time beside it have to agree about which
  // day it is, so the hint counts days in whichever zone the absolute
  // time was rendered in.
  const days = Math.round(
    (startOfLocalDay(date, options.timeZone) - startOfLocalDay(now, options.timeZone)) / 86_400_000,
  );
  try {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (Math.abs(days) < 30) return relative.format(days, 'day');
    return relative.format(Math.round(days / 30), 'month');
  } catch {
    // No `Intl` at all. English, and said so in `docs/ARCHITECTURE.md`:
    // the hint is decoration beside an absolute time that still renders.
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
  }
}
