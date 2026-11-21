import {
  WEEKDAYS,
  validateWeek,
  type AvailabilityDay,
  type AvailabilityService,
  type WeeklyAvailability,
} from '../model/availability';

/**
 * The weekly grid for the demo (DEC-005), with the server's semantics: the
 * whole week is replaced, an inconsistent week is refused with a 422 naming
 * the day (`week[i]`) and nothing is kept, and saving moves no appointment —
 * the demo book is untouched by a narrower week, exactly as the API leaves it.
 *
 * Two BR-DEC-005 fields are deliberately absent. The demo has no clinic
 * timezone a doctor's screen may treat as authoritative (the admin settings
 * page's localization value is demo copy for that page), so
 * `clinicTimezone` is `null` and the editor says it compares in the
 * device's zone. And it makes no `stranded` report (`null`): a report
 * computed in the device's zone would claim an exactness only the server's,
 * in the clinic's zone, has. The editor's preview still runs.
 */

const MOCK_LATENCY_MS = 400;

const delay = () => new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

const WEEKDAY_HOURS: AvailabilityDay = {
  weekday: 'Mon',
  open: true,
  windows: [{ start: '09:00', end: '17:00' }],
  breaks: [{ start: '12:00', end: '13:00' }],
};

function seed(): WeeklyAvailability {
  return {
    week: WEEKDAYS.map((weekday) =>
      weekday === 'Sat' || weekday === 'Sun'
        ? { weekday, open: false, windows: [], breaks: [] }
        : { ...WEEKDAY_HOURS, weekday },
    ),
    defaultDurationMin: 30,
    bufferMin: 0,
    clinicTimezone: null,
  };
}

let stored = seed();

/** Test hook: back to the seeded week. */
export function __resetMockAvailability(): void {
  stored = seed();
}

function refused(fieldErrors: Record<string, string[]>): Error {
  return Object.assign(new Error('API error: validation'), {
    kind: 'validation',
    code: 'validation_failed',
    fieldErrors,
  });
}

export const mockAvailabilityService: AvailabilityService = {
  async get() {
    await delay();
    return stored;
  },

  async replace(next) {
    await delay();
    const errors = validateWeek(next);
    const fieldErrors: Record<string, string[]> = {};
    next.week.forEach((day, index) => {
      const problems = errors.days[day.weekday];
      if (problems !== undefined) fieldErrors[`week[${String(index)}]`] = [...problems];
    });
    if (errors.defaultDurationMin !== undefined) {
      fieldErrors['defaultDurationMin'] = [errors.defaultDurationMin];
    }
    if (errors.bufferMin !== undefined) fieldErrors['bufferMin'] = [errors.bufferMin];
    if (Object.keys(fieldErrors).length > 0) throw refused(fieldErrors);

    stored = {
      week: next.week.map((day) => ({
        weekday: day.weekday,
        open: day.open,
        windows: day.open ? [...day.windows].sort((a, b) => a.start.localeCompare(b.start)) : [],
        breaks: day.open ? [...day.breaks].sort((a, b) => a.start.localeCompare(b.start)) : [],
      })),
      defaultDurationMin: next.defaultDurationMin,
      bufferMin: next.bufferMin,
      clinicTimezone: null,
    };
    return { saved: stored, stranded: null };
  },
};
