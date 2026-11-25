import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import type * as ProvidersModule from '@/app/providers';
import { routes } from '@/routes';
import { setPreference } from '@/services/preferences';
import { expectSoundHeadingOutline } from '@/test/heading-outline';

import { readFollowUps, writeFollowUps } from '../model/time-off-follow-up';
import type { TimeOffBlock, TimeOffCreated } from '../model/time-off-service';
import { appointmentsRoutes } from '../routes';
import { timeOffService } from '../service';

/**
 * The Upcoming Time Off and Block Time Off pages (API §3.9, UX §2.4), which
 * replaced the Appointments toolbar's drawer and dialog. Rendered through the
 * feature's real route config, entered directly by URL, with the time-off
 * port stubbed per case — so each test states what the server answered.
 */

const LOAD = { timeout: 10_000 };

/*
 * A signed-in doctor: the interrupted-follow-up record is kept per user.
 * Only `useAuth` is replaced; every other provider is the real one.
 */
const DOCTOR_ID = 'u-doctor-test';
vi.mock('@/app/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof ProvidersModule>();
  return { ...actual, useAuth: () => ({ user: { id: 'u-doctor-test' } }) };
});

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
  window.localStorage.clear();
});

const BLOCK: TimeOffBlock = {
  id: 'toff-1',
  startsAt: '2099-10-05T08:00:00.000Z',
  endsAt: '2099-10-05T18:00:00.000Z',
  kind: 'vacation',
};

const CREATED: TimeOffCreated = {
  block: {
    id: 'toff-2',
    startsAt: '2099-10-06T08:00:00.000Z',
    endsAt: '2099-10-06T18:00:00.000Z',
    kind: 'emergency-block',
  },
  impacted: [
    {
      id: 'APT-1',
      scheduledAt: '2099-10-06T09:00:00.000Z',
      durationMin: 30,
      status: 'pending',
      patientId: 'PT-1001',
    },
    {
      id: 'APT-2',
      scheduledAt: '2099-10-06T11:00:00.000Z',
      durationMin: 30,
      status: 'scheduled',
      patientId: 'PT-1002',
    },
  ],
};

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <AppProviders>
            <Outlet />
          </AppProviders>
        ),
        children: [...appointmentsRoutes],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** `datetime-local` value for a UTC instant, in the test machine's zone. */
function local(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

describe('routes', () => {
  it('opens Upcoming Time Off directly by URL, not as an appointment id', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([]);
    const router = renderAt(routes.doctor.upcomingTimeOff);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Upcoming time off' }, LOAD),
    ).toBeInTheDocument();
    expect(router.state.matches.at(-1)?.route.path).toBe('/doctor/appointments/time-off');
  });

  it('opens Block Time Off directly by URL', async () => {
    const router = renderAt(routes.doctor.blockTimeOff);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Block time off' }, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block time' })).toBeInTheDocument();
    expect(router.state.matches.at(-1)?.route.path).toBe('/doctor/appointments/time-off/new');
  });

  it('declares both static routes before `:appointmentId`, each with a translated title', () => {
    const paths = appointmentsRoutes.map((route) => route.path);
    const dynamic = paths.indexOf('/doctor/appointments/:appointmentId');
    expect(paths.indexOf('/doctor/appointments/time-off')).toBeLessThan(dynamic);
    expect(paths.indexOf('/doctor/appointments/time-off/new')).toBeLessThan(dynamic);
    const titleOf = (path: string) =>
      (appointmentsRoutes.find((route) => route.path === path)?.handle as { titleKey?: string })
        ?.titleKey;
    expect(titleOf('/doctor/appointments/time-off')).toBe('route.upcomingTimeOff');
    expect(titleOf('/doctor/appointments/time-off/new')).toBe('route.blockTimeOff');
  });
});

describe('UpcomingTimeOffPage', () => {
  it('lists what the server returned, with times, duration and kind', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([
      BLOCK,
      { ...CREATED.block, endsAt: '2099-10-07T10:30:00.000Z' },
    ]);
    renderAt(routes.doctor.upcomingTimeOff);

    const list = await screen.findByRole('list', { name: 'Upcoming time off' }, LOAD);
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('10 h')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Planned')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('1 d 2 h 30 min')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Emergency')).toBeInTheDocument();
  });

  it('says there is none when the server lists none, and links to Block Time Off', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([]);
    const router = renderAt(routes.doctor.upcomingTimeOff);

    expect(await screen.findByText('No upcoming time off', undefined, LOAD)).toBeInTheDocument();
    // The list card has no title, so the state heading follows the h1 directly.
    expectSoundHeadingOutline();
    const buttons = screen.getAllByRole('button', { name: 'Block time off' });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(router.state.location.pathname).toBe(routes.doctor.blockTimeOff));
  });

  it('reports a failed load as a failure, never as "none", and retries on request', async () => {
    const list = vi
      .spyOn(timeOffService, 'listBlocks')
      .mockRejectedValueOnce(Object.assign(new Error('API error: server'), { kind: 'server' }))
      .mockResolvedValue([BLOCK]);
    renderAt(routes.doctor.upcomingTimeOff);

    expect(
      await screen.findByText("Couldn't load your time off", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText('No upcoming time off')).not.toBeInTheDocument();
    expectSoundHeadingOutline();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('list', { name: 'Upcoming time off' }, LOAD),
    ).toBeInTheDocument();
    expect(list.mock.calls.length).toBeGreaterThan(1);
  });

  it('reviews one entry in detail', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([BLOCK]);
    renderAt(routes.doctor.upcomingTimeOff);

    await userEvent.click(await screen.findByRole('button', { name: /^Review time off / }, LOAD));
    const drawer = await screen.findByRole('dialog', { name: 'Time off' });
    expect(within(drawer).getByText('toff-1')).toBeInTheDocument();
    expect(within(drawer).getByText('10 h')).toBeInTheDocument();
    expect(within(drawer).getByText('Planned')).toBeInTheDocument();
  });

  it('cancels a block through a confirmation, and announces it only once it is gone', async () => {
    const list = vi
      .spyOn(timeOffService, 'listBlocks')
      .mockResolvedValueOnce([BLOCK])
      .mockResolvedValue([]);
    const remove = vi.spyOn(timeOffService, 'removeBlock').mockResolvedValue();
    renderAt(routes.doctor.upcomingTimeOff);

    await userEvent.click(await screen.findByRole('button', { name: /^Cancel time off / }, LOAD));
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel this time off?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel time off' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('toff-1'));
    expect(await screen.findByText('Time off cancelled')).toBeInTheDocument();
    expect(await screen.findByText('No upcoming time off')).toBeInTheDocument();
    expect(list.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps the block and says so when the server refuses the cancel', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([BLOCK]);
    vi.spyOn(timeOffService, 'removeBlock').mockRejectedValue(new Error('down'));
    renderAt(routes.doctor.upcomingTimeOff);

    await userEvent.click(await screen.findByRole('button', { name: /^Cancel time off / }, LOAD));
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel this time off?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel time off' }));

    expect(await screen.findByText("Couldn't cancel the time off")).toBeInTheDocument();
    expect(screen.queryByText('Time off cancelled')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cancel time off / })).toBeInTheDocument();
  });

  it('goes back to the appointment book', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([]);
    const router = renderAt(routes.doctor.upcomingTimeOff);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Back to appointments' }, LOAD),
    );
    await waitFor(
      () => expect(router.state.location.pathname).toBe(routes.doctor.appointments),
      LOAD,
    );
  });
});

describe('BlockTimeOffPage', () => {
  async function openForm() {
    const router = renderAt(routes.doctor.blockTimeOff);
    await screen.findByRole('button', { name: 'Block time' }, LOAD);
    return router;
  }

  it('requires both ends of the window, inline, and sends nothing', async () => {
    const create = vi.spyOn(timeOffService, 'createBlock');
    await openForm();

    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));

    expect(screen.getByText('Enter the start date and time')).toBeInTheDocument();
    expect(screen.getByText('Enter the end date and time')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an end at or before the start, and sends nothing', async () => {
    const create = vi.spyOn(timeOffService, 'createBlock');
    await openForm();

    const start = local('2099-10-06T08:00:00.000Z');
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: start } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: start } });
    expect(screen.getByText('The end must be after the start')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the window and kind once while pending, then announces it and moves to the list', async () => {
    let settle: (value: TimeOffCreated) => void = () => undefined;
    const create = vi.spyOn(timeOffService, 'createBlock').mockImplementation(
      () =>
        new Promise<TimeOffCreated>((resolve) => {
          settle = resolve;
        }),
    );
    // Not booked yet when the form checks; booked once the create lands.
    vi.spyOn(timeOffService, 'listBlocks')
      .mockResolvedValueOnce([])
      .mockResolvedValue([CREATED.block]);
    const router = await openForm();

    await userEvent.click(screen.getByRole('combobox', { name: 'Kind' }));
    await userEvent.click(await screen.findByRole('option', { name: /Emergency/ }));
    fireEvent.change(screen.getByLabelText(/^From/), {
      target: { value: local(CREATED.block.startsAt) },
    });
    fireEvent.change(screen.getByLabelText(/^To/), {
      target: { value: local(CREATED.block.endsAt) },
    });

    const submit = screen.getByRole('button', { name: 'Block time' });
    await userEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalled());
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      from: CREATED.block.startsAt,
      to: CREATED.block.endsAt,
      kind: 'emergency-block',
    });
    expect(screen.queryByText('Time off blocked')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.doctor.blockTimeOff);

    settle({ ...CREATED, impacted: [] });

    expect(await screen.findByText('Time off blocked', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe(routes.doctor.upcomingTimeOff));
  });

  it('shows the server’s refusal in its own words, and stays put', async () => {
    vi.spyOn(timeOffService, 'createBlock').mockRejectedValue(
      Object.assign(new Error('API error: conflict'), {
        kind: 'conflict',
        code: 'time_off_overlap',
        detail: 'This overlaps time off you already blocked',
      }),
    );
    const router = await openForm();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));

    expect(
      await screen.findByText('This overlaps time off you already blocked', undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText('Time off blocked')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.doctor.blockTimeOff);
    expect(screen.getByRole('button', { name: 'Block time' })).toBeEnabled();
  });

  it('shows the blast radius before anything is sent, confirms the count it showed, and keeps skips on screen', async () => {
    vi.spyOn(timeOffService, 'createBlock').mockResolvedValue(CREATED);
    const resolve = vi.spyOn(timeOffService, 'resolve').mockResolvedValue({
      resolved: ['APT-1'],
      skipped: [{ id: 'APT-2', reason: 'scheduled → awaiting-patient is not allowed' }],
      notified: 1,
    });
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([CREATED.block]);
    const router = await openForm();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));

    expect(
      await screen.findByText('2 appointments fall inside this time', undefined, LOAD),
    ).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: /Cancel with an apology/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Notify 2 patients' }));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith('toff-2', {
        action: 'cancel-apology',
        confirmedCount: 2,
      });
    });
    expect(await screen.findByText('1 handled · 1 notified', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('1 skipped — still need a decision')).toBeInTheDocument();
    expect(screen.getByText(/scheduled → awaiting-patient is not allowed/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.doctor.blockTimeOff);

    await userEvent.click(screen.getByRole('button', { name: 'View upcoming time off' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(routes.doctor.upcomingTimeOff));
  });

  it('sends nothing when the doctor leaves the appointments for now', async () => {
    vi.spyOn(timeOffService, 'createBlock').mockResolvedValue(CREATED);
    const resolve = vi.spyOn(timeOffService, 'resolve');
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([CREATED.block]);
    const router = await openForm();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Leave them for now/ }, LOAD));
    await userEvent.click(screen.getByRole('button', { name: 'Leave them for now' }));

    expect(
      await screen.findByText(/2 appointments left as they are/, undefined, LOAD),
    ).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
    await waitFor(() => expect(router.state.location.pathname).toBe(routes.doctor.upcomingTimeOff));
  });

  it('reports a changed blast radius in the server’s words, without claiming success', async () => {
    vi.spyOn(timeOffService, 'createBlock').mockResolvedValue(CREATED);
    vi.spyOn(timeOffService, 'resolve').mockRejectedValue(
      Object.assign(new Error('API error: conflict'), {
        kind: 'conflict',
        code: 'blast_radius_changed',
        detail: 'The appointments in this window changed since you reviewed them',
      }),
    );
    await openForm();

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Offer a colleague/ }, LOAD));
    await userEvent.click(screen.getByRole('button', { name: 'Notify 2 patients' }));

    expect(
      await screen.findByText(
        'The appointments in this window changed since you reviewed them',
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/handled/)).not.toBeInTheDocument();
  });
});

/** Books `CREATED`'s window on the Block page and returns the router. */
async function bookCreatedWindow() {
  const router = renderAt(routes.doctor.blockTimeOff);
  await screen.findByRole('button', { name: 'Block time' }, LOAD);
  await userEvent.click(screen.getByRole('combobox', { name: 'Kind' }));
  await userEvent.click(await screen.findByRole('option', { name: /Emergency/ }));
  fireEvent.change(screen.getByLabelText(/^From/), {
    target: { value: local(CREATED.block.startsAt) },
  });
  fireEvent.change(screen.getByLabelText(/^To/), {
    target: { value: local(CREATED.block.endsAt) },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Block time' }));
  return router;
}

describe('Block Time Off — a booked block never loses its follow-up silently', () => {
  it('asks before leaving while the save is in flight, and Stay keeps the page', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([]);
    vi.spyOn(timeOffService, 'createBlock').mockImplementation(() => new Promise(() => undefined));
    const router = await bookCreatedWindow();
    await screen.findByText('Saving your time off…', undefined, LOAD);

    await userEvent.click(screen.getByRole('button', { name: 'Back to appointments' }));
    expect(
      await screen.findByRole('heading', { name: 'Your time off is still being saved' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.doctor.blockTimeOff);

    await userEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(router.state.location.pathname).toBe(routes.doctor.blockTimeOff);
  });

  it('records the follow-up when the doctor leaves mid-save and the server books it afterwards', async () => {
    let settle: (value: TimeOffCreated) => void = () => undefined;
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([]);
    vi.spyOn(timeOffService, 'createBlock').mockImplementation(
      () =>
        new Promise<TimeOffCreated>((resolve) => {
          settle = resolve;
        }),
    );
    const router = await bookCreatedWindow();
    await screen.findByText('Saving your time off…', undefined, LOAD);
    // Before the answer: an outcome not known yet.
    expect(readFollowUps(DOCTOR_ID).map((record) => record.state)).toEqual(['saving']);

    await userEvent.click(screen.getByRole('button', { name: 'Back to appointments' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(routes.doctor.appointments));

    settle(CREATED);
    await waitFor(() =>
      expect(readFollowUps(DOCTOR_ID)).toEqual([
        expect.objectContaining({ state: 'follow-up', blockId: 'toff-2' }),
      ]),
    );
  });

  it('asks before leaving a booked block whose appointments are undecided', async () => {
    vi.spyOn(timeOffService, 'listBlocks')
      .mockResolvedValueOnce([])
      .mockResolvedValue([CREATED.block]);
    vi.spyOn(timeOffService, 'createBlock').mockResolvedValue(CREATED);
    const resolve = vi.spyOn(timeOffService, 'resolve');
    const router = await bookCreatedWindow();
    await screen.findByText('2 appointments fall inside this time', undefined, LOAD);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Leave without deciding about these appointments?',
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Leave anyway' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(routes.doctor.upcomingTimeOff));
    expect(resolve).not.toHaveBeenCalled();
    // Upcoming Time Off flags the block and offers the decision again.
    expect(await screen.findByText('Follow-up needed', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Appointments still need a decision')).toBeInTheDocument();
  });

  it('does not book the same window twice: an existing identical block goes straight to its follow-up', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([CREATED.block]);
    const create = vi.spyOn(timeOffService, 'createBlock');
    const preview = vi.spyOn(timeOffService, 'previewImpact').mockResolvedValue(CREATED.impacted);
    await bookCreatedWindow();

    expect(
      await screen.findByText(/This time off was already booked/, undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByText('2 appointments fall inside this time')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledWith(CREATED.block);
  });

  it('books nothing when the existing blocks cannot be checked', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockRejectedValue(new Error('offline'));
    const create = vi.spyOn(timeOffService, 'createBlock');
    await bookCreatedWindow();

    expect(
      await screen.findByText(/Couldn't check your existing time off/, undefined, LOAD),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('a dropped connection says the outcome is unknown and keeps the record; a refusal clears it', async () => {
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([]);
    const create = vi
      .spyOn(timeOffService, 'createBlock')
      .mockRejectedValueOnce(Object.assign(new Error('API error: network'), { kind: 'network' }))
      .mockRejectedValueOnce(
        Object.assign(new Error('API error: validation'), {
          kind: 'validation',
          fieldErrors: { to: ['The end must be after the start'] },
        }),
      );
    await bookCreatedWindow();

    expect(
      await screen.findByText(/may or may not have been saved/, undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText('Time off blocked')).not.toBeInTheDocument();
    expect(readFollowUps(DOCTOR_ID).map((record) => record.state)).toEqual(['saving']);

    await userEvent.click(screen.getByRole('button', { name: 'Block time' }));
    expect(
      await screen.findByText('The end must be after the start', undefined, LOAD),
    ).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
    // The refused attempt's record is gone; the unknown one stays until reconciled.
    expect(readFollowUps(DOCTOR_ID)).toHaveLength(1);
  });
});

describe('Upcoming Time Off — recovering an interrupted follow-up', () => {
  it('turns a save whose answer was lost into a follow-up when the server lists that block', async () => {
    writeFollowUps(DOCTOR_ID, [
      {
        state: 'saving',
        id: 'r1',
        from: CREATED.block.startsAt,
        to: CREATED.block.endsAt,
        kind: CREATED.block.kind,
        at: Date.now() - 60 * 60_000,
      },
    ]);
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([CREATED.block]);
    renderAt(routes.doctor.upcomingTimeOff);

    expect(await screen.findByText('Follow-up needed', undefined, LOAD)).toBeInTheDocument();
    expect(readFollowUps(DOCTOR_ID)).toEqual([
      expect.objectContaining({ state: 'follow-up', blockId: 'toff-2' }),
    ]);
  });

  it('re-reads the impact from the server, sends the count it showed, and clears the flag once decided', async () => {
    writeFollowUps(DOCTOR_ID, [
      {
        state: 'follow-up',
        id: 'r1',
        blockId: 'toff-2',
        from: CREATED.block.startsAt,
        to: CREATED.block.endsAt,
        kind: CREATED.block.kind,
        at: Date.now(),
      },
    ]);
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([CREATED.block]);
    const preview = vi.spyOn(timeOffService, 'previewImpact').mockResolvedValue(CREATED.impacted);
    const resolve = vi
      .spyOn(timeOffService, 'resolve')
      .mockResolvedValue({ resolved: ['APT-1', 'APT-2'], skipped: [], notified: 2 });
    renderAt(routes.doctor.upcomingTimeOff);

    await userEvent.click(
      await screen.findByRole('button', { name: /Handle the appointments inside time off/ }, LOAD),
    );
    expect(
      await screen.findByText('2 appointments fall inside this time', undefined, LOAD),
    ).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(CREATED.block);

    await userEvent.click(screen.getByRole('radio', { name: /Cancel with an apology/ }));
    const notify = screen.getByRole('button', { name: 'Notify 2 patients' });
    await userEvent.click(notify);
    fireEvent.click(notify);

    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith('toff-2', {
        action: 'cancel-apology',
        confirmedCount: 2,
      }),
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('2 handled · 2 notified', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Follow-up needed')).not.toBeInTheDocument());
    expect(readFollowUps(DOCTOR_ID)).toEqual([]);
  });

  it('says plainly when a save it was waiting on is not among the upcoming blocks', async () => {
    writeFollowUps(DOCTOR_ID, [
      {
        state: 'saving',
        id: 'r1',
        from: CREATED.block.startsAt,
        to: CREATED.block.endsAt,
        kind: CREATED.block.kind,
        at: Date.now() - 60 * 60_000,
      },
    ]);
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([]);
    renderAt(routes.doctor.upcomingTimeOff);

    expect(
      await screen.findByText(/is not in your upcoming time off/, undefined, LOAD),
    ).toBeInTheDocument();
    expect(readFollowUps(DOCTOR_ID)).toEqual([]);
  });
});

describe('Time off pages in Arabic — direct navigation keeps the localized identity', () => {
  afterEach(() => {
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'en';
  });

  it.each([
    [routes.doctor.upcomingTimeOff, 'الإجازات القادمة'],
    [routes.doctor.blockTimeOff, 'حجز إجازة'],
  ])('%s opens right-to-left, titled "%s"', async (path, title) => {
    setPreference('locale', 'ar');
    vi.spyOn(timeOffService, 'listBlocks').mockResolvedValue([BLOCK]);
    renderAt(path);

    expect(await screen.findByRole('heading', { level: 1, name: title }, LOAD)).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    const crumbs = screen.getByRole('navigation', { name: /./ });
    expect(crumbs).toHaveTextContent('المواعيد');
    expect(screen.getByRole('button', { name: 'العودة إلى المواعيد' })).toBeInTheDocument();
  });
});
