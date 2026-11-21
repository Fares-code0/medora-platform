import fs from 'node:fs';
import path from 'node:path';

import {
  formatDate,
  formatDateTime,
  formatLongDate,
  formatRelative,
  formatTime,
  isDeviceTimeZone,
} from './datetime';

/**
 * Date and time formatting — checklist A-08, audit R-12.
 *
 * `datetime.ts` was at 68.4% statements and **47.6% branches**, the
 * lowest branch figure in the platform layer. The untaken branches are
 * the two that matter: an unparseable date, and a runtime with no `Intl`.
 * Both are paths where the wrong behaviour is a patient reading a blank
 * or a crash where a time should be.
 *
 * ── Two things these tests deliberately do NOT assert ────────────────
 *
 * Exact strings. Even given a locale, "Mon 14 Sep" is `en-GB`'s answer
 * and `en-US` gives "Mon, Sep 14"; pinning either would make the suite
 * fail on a machine configured differently, which is a test asserting
 * the CI image rather than this code.
 *
 * A timezone. See the last block — the device's zone applies, and that
 * is the current contract's gap rather than a property to lock in.
 *
 * ── The locale is a parameter now, and that is a fix ─────────────────
 *
 * Every call passed `undefined` to `Intl`, which resolves the DEVICE's
 * locale — so a patient who set Medora to Arabic on an English phone
 * read Arabic headings above English dates, and "tomorrow" was
 * hard-coded in English besides. The parameter is required, so no call
 * site can fall back to the phone's language by omission.
 */

const INSTANT = '2026-09-14T06:30:00.000Z';

describe('formatting a real instant', () => {
  it('renders a date that is not the raw ISO string', () => {
    const formatted = formatDate(INSTANT, 'en');

    expect(formatted).not.toBe(INSTANT);
    expect(formatted).toMatch(/14/);
    expect(formatted).toMatch(/Sep/i);
  });

  it('renders a long date with the full month and the year', () => {
    const formatted = formatLongDate(INSTANT, 'en');

    expect(formatted).toMatch(/September/i);
    expect(formatted).toMatch(/2026/);
  });

  it('renders a time with an hour and a minute', () => {
    expect(formatTime(INSTANT, 'en')).toMatch(/\d{1,2}[:.]\d{2}/);
  });

  it('composes the card line from the two, so they cannot disagree', () => {
    expect(formatDateTime(INSTANT, 'en')).toBe(
      `${formatDate(INSTANT, 'en')}, ${formatTime(INSTANT, 'en')}`,
    );
  });

  it('is stable across calls — nothing here reads a clock', () => {
    // The absolute formatters take no `now`. A patient reloading a screen
    // must not see the appointment time change.
    expect(formatDateTime(INSTANT, 'en')).toBe(formatDateTime(INSTANT, 'en'));
  });
});

describe('an instant it cannot parse', () => {
  it.each([
    ['an empty string', ''],
    ['a sentence', 'sometime next week'],
    ['a truncated ISO', '2026-13-45T99:99:99Z'],
  ])('returns %s verbatim rather than "Invalid Date"', (_name, input) => {
    // Verbatim, not blank: a value the server sent that this client
    // cannot read is a bug worth being visible in a screenshot, and
    // "Invalid Date" on a patient's appointment card is worse than both.
    expect(formatDate(input, 'en')).toBe(input);
    expect(formatLongDate(input, 'en')).toBe(input);
    expect(formatTime(input, 'en')).toBe(input);
    expect(formatDate(input, 'en')).not.toMatch(/Invalid/i);
  });

  it('returns nothing at all for the relative hint, which is decoration', () => {
    // The relative form is always beside an absolute time, never instead
    // of one, so dropping it costs nothing. Echoing an unparseable string
    // into "sometime next week ago" would cost something.
    expect(formatRelative('not a date', 'en')).toBe('');
  });
});

describe('a runtime without Intl', () => {
  /**
   * Hermes ships `Intl` in the variant Expo SDK 52 uses, but the
   * formatters catch anyway, and an uncaught throw here would blank a
   * screen a patient is reading. These drive the catch blocks.
   */
  function breakIntl(constructorName: 'DateTimeFormat' | 'RelativeTimeFormat') {
    const spy = jest.spyOn(Intl, constructorName).mockImplementation(() => {
      throw new RangeError('Intl is unavailable in this build');
    });
    return spy;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('degrades to the ISO date fragment rather than throwing', () => {
    breakIntl('DateTimeFormat');

    expect(formatDate(INSTANT, 'en')).toBe('2026-09-14');
    expect(formatLongDate(INSTANT, 'en')).toBe('2026-09-14');
  });

  it('degrades to the ISO time fragment', () => {
    breakIntl('DateTimeFormat');

    expect(formatTime(INSTANT, 'en')).toBe('06:30');
  });

  it('degrades the relative hint to plain English', () => {
    breakIntl('RelativeTimeFormat');
    const now = new Date('2026-09-14T06:30:00.000Z');

    expect(formatRelative('2026-09-19T06:30:00.000Z', 'en', { now })).toBe('in 5 days');
    expect(formatRelative('2026-09-09T06:30:00.000Z', 'en', { now })).toBe('5 days ago');
  });

  it('keeps the three words that carry the most meaning', () => {
    // `numeric: 'auto'` is what turns 0, 1 and -1 into today, tomorrow
    // and yesterday, and it is the first thing lost when `Intl` is. The
    // fallback says them itself, because "in 0 days" beside an
    // appointment is worse than no hint at all.
    //
    // Device-local times, like the calendar-day tests below: the hint
    // counts the device's days, so a UTC `23:00` on the 13th is the 14th
    // on any phone at UTC+1 or east of it, where "yesterday" is wrong.
    breakIntl('RelativeTimeFormat');
    const now = new Date(2026, 8, 14, 6, 30, 0);
    const local = (day: number, hour: number) => new Date(2026, 8, day, hour, 0, 0).toISOString();

    expect(formatRelative(local(14, 20), 'en', { now })).toBe('today');
    expect(formatRelative(local(15, 6), 'en', { now })).toBe('tomorrow');
    expect(formatRelative(local(13, 23), 'en', { now })).toBe('yesterday');
  });

  it('does not claim the clinic is somewhere else when it cannot tell', () => {
    // `isDeviceTimeZone` decides whether `AppointmentDetailScreen` says
    // "shown in the clinic's time zone". With no `Intl` there is no
    // device zone to compare against, and the safe answer is *yes, the
    // same* — a note naming a zone this runtime cannot resolve would be
    // a claim it has no basis for.
    breakIntl('DateTimeFormat');

    expect(isDeviceTimeZone('Asia/Amman')).toBe(true);
  });
});

describe('saying whose time zone it is (A-08)', () => {
  it('treats "no zone supplied" as the device\'s, so nothing is said', () => {
    // `clinicTimezone` is nullable and the formatters fall back to the
    // device's zone when it is absent. The note must fall back with
    // them: saying "shown in the clinic's time zone" about a time
    // rendered in the *phone's* would be exactly backwards, and this is
    // the branch every payload without a zone takes.
    expect(isDeviceTimeZone(null)).toBe(true);
  });

  it('compares rather than guesses when a zone is supplied', () => {
    const here = new Intl.DateTimeFormat().resolvedOptions().timeZone;

    expect(isDeviceTimeZone(here)).toBe(true);
    // Two names, so this holds wherever CI runs: one of them is not the
    // runner's zone.
    expect([isDeviceTimeZone('Asia/Amman'), isDeviceTimeZone('Pacific/Kiritimati')]).toContain(
      false,
    );
  });
});

describe('the relative hint (device clock, by design)', () => {
  const now = new Date('2026-09-14T12:00:00.000Z');

  it.each([
    ['today', '2026-09-14T20:00:00.000Z'],
    ['tomorrow', '2026-09-15T12:00:00.000Z'],
    ['yesterday', '2026-09-13T12:00:00.000Z'],
  ])('says %s, from `numeric: auto` rather than a hard-coded word', (expected, iso) => {
    // These three used to be hard-coded in English ahead of
    // `RelativeTimeFormat`, on the argument that `numeric: 'auto'` is not
    // guaranteed to produce them in every locale. It does in both of
    // this app's, and the hard-coding guaranteed the opposite: every
    // appointment card in Arabic said "tomorrow".
    expect(formatRelative(iso, 'en', { now })).toBe(expected);
  });

  it('says them in the language it was given, which is the whole point', () => {
    // Not an assertion about Arabic wording — an assertion that the
    // locale reaches `Intl` at all. Before 2026-09-12 every one of these
    // came back in English whatever the app's language was.
    for (const iso of [
      '2026-09-14T20:00:00.000Z',
      '2026-09-15T12:00:00.000Z',
      '2026-09-13T12:00:00.000Z',
      '2026-09-24T12:00:00.000Z',
    ]) {
      expect(formatRelative(iso, 'ar', { now })).not.toBe(formatRelative(iso, 'en', { now }));
    }
  });

  it('counts CALENDAR days, so late-evening "tomorrow morning" is not "today"', () => {
    // The old rule rounded elapsed milliseconds: at 22:00, a 09:00
    // appointment the next morning is eleven hours away, which rounds to
    // zero — and the card said "today" about tomorrow. No amount of
    // rounding turns an elapsed-time question into a calendar one.
    const lateEvening = new Date(2026, 8, 14, 22, 0, 0);
    const nextMorning = new Date(2026, 8, 15, 9, 0, 0).toISOString();

    expect(formatRelative(nextMorning, 'en', { now: lateEvening })).toBe('tomorrow');
  });

  it('still calls the small hours of the same day "today"', () => {
    const lateEvening = new Date(2026, 8, 14, 22, 0, 0);
    const sameNight = new Date(2026, 8, 14, 23, 30, 0).toISOString();

    expect(formatRelative(sameNight, 'en', { now: lateEvening })).toBe('today');
  });

  it('counts in days inside a month', () => {
    expect(formatRelative('2026-09-24T12:00:00.000Z', 'en', { now })).toMatch(/10 days|in 10/i);
  });

  it('switches to months beyond thirty days rather than saying "in 96 days"', () => {
    expect(formatRelative('2026-12-19T12:00:00.000Z', 'en', { now })).toMatch(/month/i);
  });

  it('reads the clock it is given, so a test is not at the mercy of the real one', () => {
    expect(formatRelative('2026-09-15T12:00:00.000Z', 'en', { now })).toBe('tomorrow');
    expect(
      formatRelative('2026-09-15T12:00:00.000Z', 'en', {
        now: new Date('2026-09-20T12:00:00.000Z'),
      }),
    ).not.toBe('tomorrow');
  });

  it('calls 23 hours away "tomorrow", which is the direction that matters', () => {
    // Getting this wrong the other way is what sends somebody to a
    // clinic on the wrong day.
    expect(formatRelative('2026-09-15T11:00:00.000Z', 'en', { now })).toBe('tomorrow');
  });
});

describe('what this file must not grow (A-08, R-12)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'datetime.ts'), 'utf8');

  it('does no arithmetic on a clinic rule', () => {
    // "Is the clinic open?", "is this slot bookable?", a DST boundary —
    // all of those are the clinic's timezone applied server-side. A
    // second implementation here disagrees with the first on the last
    // Sunday in October.
    for (const forbidden of [
      /isOpen/i,
      /openingHours/i,
      /workingDay/i,
      /holiday/i,
      /slotIsFree/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('pins no timezone of its own — every one comes from the caller', () => {
    // This test used to forbid `timeZone:` outright, and explained that
    // rendering in the clinic's zone "needs `localization.timezone`,
    // which arrives with `GET /public/clinic` (BE-11) and does not exist
    // yet". **That premise was wrong about appointments.**
    // `GET /me/appointments` has returned `clinicTimezone` on the page
    // and on the detail since it was written, the schema parsed it, and
    // the mapper dropped it — so a patient in London read 07:30 for
    // their own 09:30 appointment in Amman.
    //
    // What the guard was protecting is still protected, and is what it
    // now says: this file **invents** no zone. There is no IANA name in
    // it, and no `resolvedOptions().timeZone` standing in as a default
    // — the only zone it can render in is one a caller passed, which is
    // one the server sent.
    expect(source).not.toMatch(/['"`][A-Za-z]+\/[A-Za-z_]+['"`]/);
    expect(source).not.toMatch(/timeZone\s*:\s*['"`]/);
    // `resolvedOptions().timeZone` appears once, and only to COMPARE:
    // `isDeviceTimeZone` answers "is this the zone the phone is in?", so
    // a screen can say when a time is the clinic's. It is never a
    // default a formatter falls back to.
    expect([...source.matchAll(/resolvedOptions\(\)\.timeZone/g)]).toHaveLength(1);
    expect(source).toMatch(/resolvedOptions\(\)\.timeZone === timeZone/);

    // Every `timeZone:` in the file is the parameter, spread in only
    // when one was given.
    const supplied = [...source.matchAll(/timeZone\s*:/g)].length;
    const spreads = [...source.matchAll(/timeZone === undefined \? \{\} : \{ timeZone \}/g)].length;
    expect(supplied).toBeGreaterThan(0);
    expect(spreads).toBeGreaterThan(0);
  });

  it('keeps the DEVICE zone when no caller supplies one', () => {
    // Everything that is not an appointment — a prescription's date, a
    // notification's timestamp — has no zone in its contract, and that
    // gap is unchanged: the device's applies, exactly as before.
    const noZone = formatTime(INSTANT, 'en');
    expect(formatTime(INSTANT, 'en', undefined)).toBe(noZone);
  });

  it('renders an instant in the zone it is given, which is the point', () => {
    // 06:30 UTC is 09:30 in Amman and 02:30 in New York. The same
    // instant, three answers, and only one of them is the appointment a
    // patient is being asked to attend.
    expect(formatTime(INSTANT, 'en', 'Asia/Amman')).toMatch(/09[:.]30/);
    expect(formatTime(INSTANT, 'en', 'America/New_York')).toMatch(/02[:.]30/);
  });

  it('counts the relative hint in the same zone as the time beside it', () => {
    // Otherwise the two disagree at the edges of a day: an appointment
    // that is "tomorrow" in the clinic's zone would read "today" under
    // the device's, next to a date that says otherwise.
    const nearMidnightUtc = '2026-09-14T22:00:00.000Z';
    const now = new Date('2026-09-14T20:00:00.000Z');

    // In Amman (UTC+3) that instant is 01:00 on the 15th and `now` is
    // 23:00 on the 14th — tomorrow. In UTC both are the 14th.
    expect(formatRelative(nearMidnightUtc, 'en', { now, timeZone: 'Asia/Amman' })).toBe('tomorrow');
    expect(formatRelative(nearMidnightUtc, 'en', { now, timeZone: 'UTC' })).toBe('today');
  });

  it('falls back to the device zone rather than throwing on a name it cannot read', () => {
    // A zone name is server data. A typo in it must not blank a screen.
    expect(formatRelative(INSTANT, 'en', { now: new Date(INSTANT), timeZone: 'Not/AZone' })).toBe(
      'today',
    );
  });
});
