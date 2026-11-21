import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { AppProviders } from '@/app/providers';

import type { AppointmentService, CreateAppointmentInput } from '../model/appointment-service';
import { WEEKDAYS, type WeeklyAvailability, type Weekday } from '../model/availability';
import { clinicToday, formatBookingDate, weekdayOf } from '../model/booking';
import { addDays } from '../model/calendar';
import type { TimeOffBlock } from '../model/time-off-service';
import type { Appointment } from '../model/types';
import { appointmentService, availabilityService, timeOffService } from '../service';

import { NewAppointmentPage } from './NewAppointmentPage';

/**
 * The New Appointment page end to end, in the DOM.
 *
 * The clinic zone is pinned to Asia/Tokyo (UTC+9, no DST) so every date and
 * instant below is exact whatever zone the test machine runs in — which is
 * the point: the original "outside working hours" failure came from reading
 * the doctor's pick in the device's zone instead of the clinic's.
 *
 * A data router (`createMemoryRouter`), because the unsaved-changes guard
 * uses `useBlocker`, which only exists on one.
 */

const LOAD = { timeout: 10_000 };
const CASE_TIMEOUT = 30_000;
const ZONE = 'Asia/Tokyo';

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
  // Every data-router navigation builds a Request. Under jsdom the global
  // Request is Node's (undici) while AbortSignal is jsdom's, and undici
  // rejects a signal from another realm — an environment artifact, not app
  // behaviour. The same structural stand-in `features/admin/routes.test.tsx`
  // uses; these routes have no loaders.
  vi.stubGlobal(
    'Request',
    class {
      readonly url: string;
      readonly signal: AbortSignal | undefined;
      constructor(url: string, init?: { signal?: AbortSignal }) {
        this.url = url;
        this.signal = init?.signal;
      }
    },
  );
});

function availability(closed: readonly Weekday[] = []): WeeklyAvailability {
  return {
    week: WEEKDAYS.map((weekday) =>
      closed.includes(weekday)
        ? { weekday, open: false, windows: [], breaks: [] }
        : {
            weekday,
            open: true,
            windows: [{ start: '09:00', end: '17:00' }],
            breaks: [{ start: '12:00', end: '13:00' }],
          },
    ),
    defaultDurationMin: 30,
    bufferMin: 0,
    clinicTimezone: ZONE,
  };
}

/** Tomorrow in the clinic — never in the past, whatever the hour. */
function target(): string {
  return addDays(clinicToday(new Date(), ZONE), 1);
}

/** The UTC instant of `time` on the target day in Tokyo (UTC+9). */
function tokyoInstant(date: string, time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours - 9, minutes)).toISOString();
}

function created(input: CreateAppointmentInput): Appointment {
  return {
    id: 'apt-new',
    patient: input.patient,
    dateTime: input.dateTime,
    durationMin: input.durationMin,
    visitType: input.visitType,
    department: input.department,
    doctor: input.doctor,
    status: 'scheduled',
    priority: input.priority,
    isNewPatient: false,
    isFollowUp: false,
    reason: input.reason,
    notes: null,
  };
}

function booked(dateTime: string): Appointment {
  return {
    id: 'apt-taken',
    patient: { id: 'PT-2', name: 'Other', mrn: '2', phone: '', age: 30, gender: 'female' },
    dateTime,
    durationMin: 30,
    visitType: 'Consultation',
    department: 'General Medicine',
    doctor: 'Doctor',
    status: 'confirmed',
    priority: 'normal',
    isNewPatient: false,
    isFollowUp: false,
    reason: 'x',
    notes: null,
  };
}

let createSpy: MockInstance<AppointmentService['createAppointment']>;

function stubData(
  options: {
    week?: WeeklyAvailability | Error;
    book?: readonly Appointment[];
    timeOff?: readonly TimeOffBlock[];
  } = {},
) {
  const week = options.week ?? availability();
  vi.spyOn(availabilityService, 'get').mockImplementation(() =>
    week instanceof Error ? Promise.reject(week) : Promise.resolve(week),
  );
  vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([...(options.timeOff ?? [])]);
  vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([...(options.book ?? [])]);
}

beforeEach(() => {
  createSpy = vi
    .spyOn(appointmentService, 'createAppointment')
    .mockImplementation((input) => Promise.resolve(created(input)));
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderPage(entry = '/doctor/appointments/new') {
  const router = createMemoryRouter(
    [
      { path: '/doctor/appointments/new', element: <NewAppointmentPage /> },
      { path: '/doctor/appointments/:appointmentId', element: <h1>Appointment detail</h1> },
      { path: '/doctor/appointments', element: <h1>Appointments list</h1> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

type User = ReturnType<typeof userEvent.setup>;

async function choosePatient(user: User) {
  await user.click(await screen.findByRole('radio', { name: /Khaled Nassar/ }, LOAD));
}

async function next(user: User) {
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

function dayButton(date: string) {
  const label = formatBookingDate(date);
  return screen.queryByRole('button', { name: (name) => name.startsWith(label) });
}

async function pickDate(user: User, date: string) {
  await screen.findByRole('group', { name: 'Appointment date' }, LOAD);
  if (dayButton(date) === null)
    await user.click(screen.getByRole('button', { name: 'Next month' }));
  const button = dayButton(date);
  if (button === null) throw new Error(`No calendar button for ${date}`);
  await user.click(button);
}

function slot(time: string) {
  return screen.findByRole('radio', { name: new RegExp(`^${time} to`) }, LOAD);
}

async function toSchedule(user: User) {
  await choosePatient(user);
  await next(user);
}

async function toDetails(user: User, time = '10:00') {
  await toSchedule(user);
  await pickDate(user, target());
  await user.click(await slot(time));
  await next(user);
  await screen.findByRole('textbox', { name: /Reason for the visit/ }, LOAD);
}

async function confirmWithReason(user: User, reason = 'Follow-up on blood pressure') {
  await user.type(screen.getByRole('textbox', { name: /Reason for the visit/ }), reason);
  await user.click(screen.getByRole('button', { name: 'Confirm appointment' }));
}

describe('New Appointment page — layout and navigation', () => {
  it(
    'opens by direct navigation with a title, three steps and a way back',
    async () => {
      stubData();
      renderPage();

      expect(
        await screen.findByRole('heading', { name: 'New appointment', level: 1 }, LOAD),
      ).toBeVisible();
      const steps = screen.getByRole('navigation', { name: 'Booking steps' });
      expect(within(steps).getAllByRole('button')).toHaveLength(3);
      expect(within(steps).getByRole('button', { name: /Patient & doctor/ })).toHaveAttribute(
        'aria-current',
        'step',
      );
      expect(screen.getByRole('button', { name: 'Back to appointments' })).toBeEnabled();
      expect(screen.getByRole('complementary', { name: 'Booking summary' })).toBeVisible();
    },
    CASE_TIMEOUT,
  );

  it(
    'goes back to the list without asking when nothing was entered',
    async () => {
      stubData();
      const router = renderPage();
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Cancel' }, LOAD));
      expect(await screen.findByRole('heading', { name: 'Appointments list' })).toBeVisible();
      expect(router.state.location.pathname).toBe('/doctor/appointments');
    },
    CASE_TIMEOUT,
  );

  it(
    'asks before discarding entries, and stays when asked to',
    async () => {
      stubData();
      renderPage();
      const user = userEvent.setup();

      await choosePatient(user);
      await user.click(screen.getByRole('button', { name: 'Back to appointments' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Leave without booking?' });
      await user.click(within(dialog).getByRole('button', { name: 'Stay here' }));
      expect(screen.getByRole('radio', { name: /Khaled Nassar/ })).toBeChecked();
    },
    CASE_TIMEOUT,
  );

  it(
    'walks all three steps and keeps every entry when moving back',
    async () => {
      stubData();
      renderPage();
      const user = userEvent.setup();

      await toDetails(user);
      await user.type(screen.getByRole('textbox', { name: /Reason for the visit/ }), 'Check-up');
      await user.click(screen.getByRole('button', { name: 'Previous' }));
      expect(await slot('10:00')).toBeChecked();
      await user.click(screen.getByRole('button', { name: 'Previous' }));
      expect(await screen.findByRole('radio', { name: /Khaled Nassar/ })).toBeChecked();
      await next(user);
      await next(user);
      expect(screen.getByRole('textbox', { name: /Reason for the visit/ })).toHaveValue('Check-up');
    },
    CASE_TIMEOUT,
  );
});

describe('New Appointment page — step validation', () => {
  it(
    'requires a patient before moving on',
    async () => {
      stubData();
      renderPage();
      const user = userEvent.setup();

      await screen.findByRole('radio', { name: /Khaled Nassar/ }, LOAD);
      await next(user);
      expect(screen.getByText('Choose the patient this appointment is for.')).toBeVisible();
      expect(screen.getByRole('radiogroup', { name: /Patient/ })).toHaveAccessibleDescription(
        'Choose the patient this appointment is for.',
      );
      expect(screen.getByRole('button', { name: /Patient & doctor/ })).toHaveAttribute(
        'aria-current',
        'step',
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'requires a date, then a time',
    async () => {
      stubData();
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      await screen.findByRole('group', { name: 'Appointment date' }, LOAD);
      await next(user);
      expect(screen.getByRole('alert')).toHaveTextContent('Choose a date.');

      await pickDate(user, target());
      await slot('10:00');
      await next(user);
      expect(screen.getByText('Choose an available time.')).toHaveAttribute('role', 'alert');
    },
    CASE_TIMEOUT,
  );

  it(
    'requires a reason, and sends nothing without one',
    async () => {
      stubData();
      renderPage();
      const user = userEvent.setup();

      await toDetails(user);
      await user.click(screen.getByRole('button', { name: 'Confirm appointment' }));
      expect(await screen.findByText('Give a reason for the visit.')).toBeVisible();
      expect(createSpy).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT,
  );
});

describe('New Appointment page — scheduling', () => {
  it(
    "shows the doctor's hours and the day's slots, with taken ones disabled and labelled",
    async () => {
      stubData({ book: [booked(tokyoInstant(target(), '10:00'))] });
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      expect(
        await screen.findByText(
          "Times are in the clinic's time zone (Asia/Tokyo).",
          undefined,
          LOAD,
        ),
      ).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Your working hours' })).toBeVisible();
      await pickDate(user, target());

      expect(await slot('09:30')).toBeEnabled();
      expect(screen.getByRole('radio', { name: '10:00 to 10:30 — booked' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: '12:00 to 12:30 — break' })).toBeDisabled();
      expect(screen.queryByRole('radio', { name: /^17:00/ })).not.toBeInTheDocument();

      await user.click(await slot('09:30'));
      const summary = screen.getByRole('complementary', { name: 'Booking summary' });
      expect(summary).toHaveTextContent('09:30–10:00');
      expect(summary).toHaveTextContent(formatBookingDate(target()));
    },
    CASE_TIMEOUT,
  );

  it(
    'clears the time when the date changes',
    async () => {
      stubData();
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      await pickDate(user, target());
      await user.click(await slot('10:00'));
      await pickDate(user, addDays(target(), 1));
      expect(await slot('10:00')).not.toBeChecked();
      expect(screen.getByRole('complementary', { name: 'Booking summary' })).toHaveTextContent(
        formatBookingDate(addDays(target(), 1)),
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'drops a chosen time that a longer duration no longer fits, and says so',
    async () => {
      stubData();
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      await pickDate(user, target());
      await user.click(await slot('11:30'));
      await user.click(screen.getByRole('combobox', { name: /Duration/ }));
      await user.click(await screen.findByRole('option', { name: /60 min/ }));

      expect(await screen.findByText('11:30 is no longer available')).toBeVisible();
      expect(screen.getByRole('radio', { name: '11:30 to 12:30 — break' })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: /^16:00 to 17:00$/ })).toBeEnabled();
    },
    CASE_TIMEOUT,
  );

  it(
    'disables days the doctor does not work',
    async () => {
      const closedDay = weekdayOf(target());
      stubData({ week: availability([closedDay]) });
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      await screen.findByRole('group', { name: 'Appointment date' }, LOAD);
      if (dayButton(target()) === null)
        await user.click(screen.getByRole('button', { name: 'Next month' }));
      expect(dayButton(target())).toBeDisabled();
      expect(dayButton(target())).toHaveAccessibleName(/not a working day$/);
    },
    CASE_TIMEOUT,
  );

  it(
    'says when a day has no open time left',
    async () => {
      const day = target();
      stubData({
        timeOff: [
          {
            id: 'b1',
            startsAt: tokyoInstant(day, '00:00'),
            endsAt: tokyoInstant(day, '23:59'),
            kind: 'vacation',
          },
        ],
      });
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      await pickDate(user, day);
      expect(await screen.findByText(/No open times on this day/, undefined, LOAD)).toBeVisible();
      expect(screen.getByRole('radio', { name: '09:00 to 09:30 — time off' })).toBeDisabled();
    },
    CASE_TIMEOUT,
  );

  it(
    'explains a doctor with no working hours instead of inventing any',
    async () => {
      stubData({ week: availability([...WEEKDAYS]) });
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      expect(
        await screen.findByText('You have no working hours set', undefined, LOAD),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'Set your working hours' })).toHaveAttribute(
        'href',
        '/doctor/settings/availability',
      );
      expect(screen.queryByRole('radio', { name: / to / })).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'offers a retry when the working hours cannot be loaded',
    async () => {
      stubData({ week: Object.assign(new Error('down'), { kind: 'network' }) });
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      expect(
        await screen.findByText("Couldn't load your working hours", undefined, LOAD),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: /Try again|Retry/ })).toBeEnabled();
    },
    CASE_TIMEOUT,
  );

  it(
    'moves between slots with the arrow keys, skipping taken ones',
    async () => {
      stubData({ book: [booked(tokyoInstant(target(), '09:30'))] });
      renderPage();
      const user = userEvent.setup();

      await toSchedule(user);
      await pickDate(user, target());
      await user.click(await slot('09:00'));
      await user.keyboard('{ArrowRight}');
      expect(await slot('10:00')).toBeChecked();
      expect(screen.getByRole('radio', { name: '09:30 to 10:00 — booked' })).not.toBeChecked();
    },
    CASE_TIMEOUT,
  );
});

describe('New Appointment page — submission', () => {
  it(
    'books the clinic-zone time the doctor picked, then opens the new appointment',
    async () => {
      stubData();
      const router = renderPage();
      const user = userEvent.setup();

      await toDetails(user, '09:00');
      await confirmWithReason(user);

      expect(
        await screen.findByRole('heading', { name: 'Appointment detail' }, LOAD),
      ).toBeVisible();
      expect(router.state.location.pathname).toBe('/doctor/appointments/apt-new');
      expect(createSpy).toHaveBeenCalledTimes(1);
      const input = createSpy.mock.calls[0]?.[0] as CreateAppointmentInput;
      expect(input).toMatchObject({
        patient: { id: 'PT-1001', name: 'Khaled Nassar' },
        // 09:00 in Tokyo is 00:00 UTC — whatever zone this machine is in.
        dateTime: tokyoInstant(target(), '09:00'),
        durationMin: 30,
        visitType: 'Consultation',
        priority: 'normal',
        reason: 'Follow-up on blood pressure',
      });
      expect(typeof input.idempotencyKey).toBe('string');
      // In the document, not "visible": the toast animates in, and on a slow
      // runner it can still be at opacity 0 here — the repo's toast convention.
      expect(await screen.findByText('Appointment booked', undefined, LOAD)).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'shows the working-hours refusal inline on the schedule step, once, keeping everything else',
    async () => {
      stubData();
      createSpy.mockRejectedValue({
        kind: 'conflict',
        code: 'slot_conflict',
        detail: 'The slot falls outside the doctor’s working hours',
      });
      renderPage();
      const user = userEvent.setup();

      await toDetails(user, '10:00');
      await confirmWithReason(user, 'Annual review');

      expect(await screen.findByText('Time slot unavailable', undefined, LOAD)).toBeVisible();
      expect(screen.getAllByText('Time slot unavailable')).toHaveLength(1);
      expect(
        screen.getByText(
          "The selected appointment time is outside this doctor's working hours. Please choose an available time slot.",
        ),
      ).toBeVisible();
      expect(
        screen.getByText(
          /The server refused 10:00: “The slot falls outside the doctor’s working hours”/,
        ),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: /Date & time/ })).toHaveAttribute(
        'aria-current',
        'step',
      );

      // The refused time is cleared; the day, the patient and the reason are kept.
      expect(await slot('10:00')).not.toBeChecked();
      const summary = screen.getByRole('complementary', { name: 'Booking summary' });
      expect(summary).toHaveTextContent('Khaled Nassar');
      expect(summary).toHaveTextContent(formatBookingDate(target()));

      // Another time can be chosen at once, and the alert goes with the old one.
      await user.click(await slot('11:00'));
      expect(screen.queryByText('Time slot unavailable')).not.toBeInTheDocument();
      await next(user);
      expect(screen.getByRole('textbox', { name: /Reason for the visit/ })).toHaveValue(
        'Annual review',
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'sends one request for a double click, and disables confirm while it runs',
    async () => {
      stubData();
      let settle: (value: Appointment) => void = () => undefined;
      createSpy.mockImplementation(
        (input) =>
          new Promise<Appointment>((resolve) => {
            settle = () => resolve(created(input));
          }),
      );
      renderPage();
      const user = userEvent.setup();

      await toDetails(user);
      await user.type(screen.getByRole('textbox', { name: /Reason for the visit/ }), 'Check-up');
      const confirm = screen.getByRole('button', { name: 'Confirm appointment' });
      await user.dblClick(confirm);
      await user.click(confirm);

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(confirm).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

      settle(created(createSpy.mock.calls[0]?.[0] as CreateAppointmentInput));
      expect(
        await screen.findByRole('heading', { name: 'Appointment detail' }, LOAD),
      ).toBeVisible();
      expect(createSpy).toHaveBeenCalledTimes(1);
    },
    CASE_TIMEOUT,
  );

  it(
    'keeps the entries after a lost connection, and retries the same booking with the same key',
    async () => {
      stubData();
      createSpy.mockRejectedValueOnce({ kind: 'network' });
      renderPage();
      const user = userEvent.setup();

      await toDetails(user);
      await confirmWithReason(user, 'Check-up');

      expect(await screen.findByText('The connection was lost', undefined, LOAD)).toBeVisible();
      expect(screen.getByRole('textbox', { name: /Reason for the visit/ })).toHaveValue('Check-up');
      const confirm = screen.getByRole('button', { name: 'Confirm appointment' });
      await waitFor(() => expect(confirm).toBeEnabled());

      await user.click(confirm);
      expect(
        await screen.findByRole('heading', { name: 'Appointment detail' }, LOAD),
      ).toBeVisible();
      const [first, second] = createSpy.mock.calls.map((call) => call[0].idempotencyKey);
      expect(first).toBeDefined();
      expect(second).toBe(first);
    },
    CASE_TIMEOUT,
  );

  it(
    'uses a new key once the booking itself changes',
    async () => {
      stubData();
      createSpy.mockRejectedValueOnce({ kind: 'network' });
      renderPage();
      const user = userEvent.setup();

      await toDetails(user);
      await confirmWithReason(user, 'Check-up');
      await screen.findByText('The connection was lost', undefined, LOAD);
      await user.type(screen.getByRole('textbox', { name: /Reason for the visit/ }), ' and labs');
      await user.click(screen.getByRole('button', { name: 'Confirm appointment' }));

      await screen.findByRole('heading', { name: 'Appointment detail' }, LOAD);
      const [first, second] = createSpy.mock.calls.map((call) => call[0].idempotencyKey);
      expect(second).not.toBe(first);
    },
    CASE_TIMEOUT,
  );

  it(
    'lands a server field refusal beside its field',
    async () => {
      stubData();
      createSpy.mockRejectedValueOnce({
        kind: 'validation',
        code: 'validation_failed',
        fieldErrors: { visitType: ['Unknown visit type'] },
      });
      renderPage();
      const user = userEvent.setup();

      await toDetails(user);
      await confirmWithReason(user);
      expect(await screen.findByText('Unknown visit type', undefined, LOAD)).toBeVisible();
      expect(screen.getByRole('textbox', { name: /Reason for the visit/ })).toHaveValue(
        'Follow-up on blood pressure',
      );
    },
    CASE_TIMEOUT,
  );
});
