import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { __resetMockAvailability } from '../../mock/mock-availability-service';
import { MOCK_APPOINTMENTS } from '../../model/mock-data';
import type { Appointment } from '../../model/types';
import { appointmentService, availabilityService } from '../../service';

import { AvailabilitySection } from './AvailabilitySection';

/**
 * The weekly-hours editor in the DOM (DEC-005).
 *
 * The load-bearing cases are the negatives: an inconsistent week is never
 * sent; a save that strands a booked appointment says so and lists it, and
 * moves nothing; a book that cannot be read is reported as an unchecked
 * save, never as "none affected"; a refused save keeps the draft. And
 * (BR-DEC-005) the server's own report after a save is what stays on screen,
 * an empty report clears a preview warning, and the clinic's zone is named
 * when the server sends it.
 */

const LOAD = { timeout: 5000 };
vi.setConfig({ testTimeout: 20_000 });

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetMockAvailability();
  window.localStorage.clear();
});

function renderSection() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <AvailabilitySection />
      </AppProviders>
    </MemoryRouter>,
  );
}

/** A confirmed appointment at 10:00 local time next Monday. */
function nextMondayAppointment(): Appointment {
  const base = MOCK_APPOINTMENTS[0];
  if (base === undefined) throw new Error('no mock appointment');
  const day = new Date();
  day.setDate(day.getDate() + ((8 - day.getDay()) % 7 || 7));
  day.setHours(10, 0, 0, 0);
  return {
    ...base,
    id: 'APT-STRANDED',
    dateTime: day.toISOString(),
    durationMin: 30,
    status: 'confirmed',
  };
}

async function loaded() {
  return screen.findByRole('switch', { name: /Monday/ }, LOAD);
}

describe('AvailabilitySection', () => {
  it('loads the seven days with their state', async () => {
    renderSection();

    expect(await loaded()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /Saturday/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getAllByRole('switch')).toHaveLength(7);
    expect(screen.getByLabelText('Monday window 1 start')).toHaveValue('09:00');
  });

  it('shows a failed load as an error with a retry', async () => {
    vi.spyOn(availabilityService, 'get').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server', ref: 'x' }),
    );
    renderSection();

    expect(
      await screen.findByText("Couldn't load your working hours", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('marks an overlapping window on its day and sends nothing', async () => {
    const replace = vi.spyOn(availabilityService, 'replace');
    const list = vi.spyOn(appointmentService, 'listAppointments');
    const user = userEvent.setup();
    renderSection();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Add window to Monday' }));
    await user.click(screen.getByRole('button', { name: 'Review and save' }));

    expect(await screen.findByText("These hours can't be saved yet")).toBeInTheDocument();
    expect(screen.getByText('Working windows on one day cannot overlap')).toBeInTheDocument();
    expect(screen.queryByText('Save your working hours?')).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('lists an appointment the new hours strand, links it to reschedule, and moves nothing', async () => {
    const stranded = nextMondayAppointment();
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([stranded]);
    const runAction = vi.spyOn(appointmentService, 'runAction');
    const replace = vi.spyOn(availabilityService, 'replace');
    const user = userEvent.setup();
    renderSection();

    await user.click(await loaded());
    await user.click(screen.getByRole('button', { name: 'Review and save' }));

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(
      within(dialog).getByText('1 upcoming appointment falls outside these hours'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Saving does not move, cancel or notify anyone/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'Open appointment APT-STRANDED to reschedule' }),
    ).toHaveAttribute('href', '/doctor/appointments/APT-STRANDED');

    await user.click(within(dialog).getByRole('button', { name: 'Save hours anyway' }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledTimes(1);
    });
    expect(replace.mock.calls[0]?.[0].week[0]).toMatchObject({ weekday: 'Mon', open: false });
    expect(
      await screen.findByText(
        '1 upcoming appointment is still booked outside your hours',
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
    expect(runAction).not.toHaveBeenCalled();
  });

  it('says the check did not run when the appointments cannot be read', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockRejectedValue(
      Object.assign(new Error('API error: network'), { kind: 'network' }),
    );
    const user = userEvent.setup();
    renderSection();

    await user.click(await loaded());
    await user.click(screen.getByRole('button', { name: 'Review and save' }));

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(
      within(dialog).getByText("Your upcoming appointments couldn't be checked"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/No upcoming appointment/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save without checking' }));

    expect(
      await screen.findByText(
        'Your upcoming appointments were not checked against these hours',
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
  });

  it('says none are affected, with the time-zone limit, when none are', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([]);
    const user = userEvent.setup();
    renderSection();

    await user.click(await loaded());
    await user.click(screen.getByRole('button', { name: 'Review and save' }));

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(
      within(dialog).getByText('No upcoming appointment falls outside these hours.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/clinic’s time zone, which it has not shared with this app/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save hours' })).toBeInTheDocument();
  });

  it('names the clinic’s time zone when the server sends it (BR-DEC-005)', async () => {
    const real = await availabilityService.get();
    vi.spyOn(availabilityService, 'get').mockResolvedValue({
      ...real,
      clinicTimezone: 'Africa/Cairo',
    });
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([]);
    const user = userEvent.setup();
    renderSection();

    await user.click(await loaded());
    await user.click(screen.getByRole('button', { name: 'Review and save' }));

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(
      within(dialog).getByText(/compared in the clinic’s time zone, Africa\/Cairo/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/has not shared/)).not.toBeInTheDocument();
  });

  it('shows the server’s report after the save, naming patients from the book (BR-DEC-005)', async () => {
    const booked = nextMondayAppointment();
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([booked]);
    const real = availabilityService.replace.bind(availabilityService);
    vi.spyOn(availabilityService, 'replace').mockImplementation(async (next) => ({
      saved: (await real(next)).saved,
      stranded: [
        {
          id: booked.id,
          dateTime: booked.dateTime,
          durationMin: booked.durationMin,
          status: 'confirmed',
          patientId: booked.patient.id,
        },
        {
          id: 'APT-OTHER',
          dateTime: booked.dateTime,
          durationMin: 30,
          status: 'pending',
          patientId: 'PT-4242',
        },
      ],
    }));
    const user = userEvent.setup();
    renderSection();

    await user.click(await loaded());
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(
      within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', {
        name: 'Save hours anyway',
      }),
    );

    expect(
      await screen.findByText(
        '2 upcoming appointments are still booked outside your hours',
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/The server checked the saved hours/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`— ${booked.patient.name}`))).toBeInTheDocument();
    expect(screen.getByText(/— Patient PT-4242/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open appointment APT-OTHER to reschedule' }),
    ).toHaveAttribute('href', '/doctor/appointments/APT-OTHER');
  });

  it('clears the preview’s warning when the server reports nothing stranded (BR-DEC-005)', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([nextMondayAppointment()]);
    const real = availabilityService.replace.bind(availabilityService);
    vi.spyOn(availabilityService, 'replace').mockImplementation(async (next) => ({
      saved: (await real(next)).saved,
      stranded: [],
    }));
    const user = userEvent.setup();
    renderSection();

    await user.click(await loaded());
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(
      within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', {
        name: 'Save hours anyway',
      }),
    );

    expect(await screen.findByText('Working hours saved', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(/still booked outside your hours/)).not.toBeInTheDocument();
  });

  it('puts a server refusal on the day it names and keeps the draft', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([]);
    vi.spyOn(availabilityService, 'replace').mockRejectedValue(
      Object.assign(new Error('API error: validation'), {
        kind: 'validation',
        fieldErrors: { 'week[1].windows': ['Working windows on one day cannot overlap'] },
      }),
    );
    const user = userEvent.setup();
    renderSection();

    await user.click(await loaded());
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(
      within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', {
        name: 'Save hours',
      }),
    );

    expect(
      await screen.findByText('The server refused these hours', undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByText(/Fix the day marked below: Tuesday/)).toBeInTheDocument();
    expect(screen.getByText('Working windows on one day cannot overlap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and save' })).toBeInTheDocument();
  });

  it('reports a failed save and keeps the draft', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([]);
    vi.spyOn(availabilityService, 'replace').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server', ref: 'x' }),
    );
    const user = userEvent.setup();
    renderSection();

    await user.click(await loaded());
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(
      within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', {
        name: 'Save hours',
      }),
    );

    expect(
      await screen.findByText("Couldn't save your working hours", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Monday/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Review and save' })).toBeInTheDocument();
  });
});
