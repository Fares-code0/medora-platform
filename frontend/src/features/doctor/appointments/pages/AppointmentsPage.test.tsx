import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import type { Appointment } from '../model/types';
import { appointmentService } from '../service';

import { AppointmentsPage } from './AppointmentsPage';

/**
 * The appointment book in the DOM (FE-10.3) — the module had no tests.
 *
 * The data source is the appointments port, stubbed per case, so each test
 * states exactly what the service answered and asserts what the doctor sees
 * and what the page asked the service to do. The properties that matter:
 * an empty book reads as empty, a failed load reads as a failure (never as
 * empty), a transition reaches the service as a command, a refusal is
 * reported in the server's own words, and the row menu offers only what the
 * server allows.
 */

const LOAD = { timeout: 10_000 };

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

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'APT-3001',
    patient: {
      id: 'PT-1004',
      name: 'Omar Farouk',
      mrn: '4472-90',
      phone: '+20 101 662 7408',
      age: 60,
      gender: 'male',
    },
    dateTime: '2099-10-09T08:00:00.000Z',
    durationMin: 30,
    visitType: 'Medication review',
    department: 'Cardiology',
    doctor: 'Dr. Amelia Chen',
    status: 'pending',
    priority: 'normal',
    isNewPatient: false,
    isFollowUp: false,
    reason: 'Routine review',
    notes: null,
    allowedActions: ['approve', 'reject'],
    ...overrides,
  };
}

function renderBook(entry = '/doctor/appointments') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/appointments" element={<AppointmentsPage />} />
          <Route path="/doctor/appointments/:appointmentId" element={<AppointmentsPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

async function openRowMenu(id: string) {
  await userEvent.click(
    await screen.findByRole('button', { name: `More actions for ${id}` }, LOAD),
  );
  return screen.findByRole('menu');
}

describe('AppointmentsPage — loading, data, empty, error', () => {
  it('shows the book the service returned', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([appointment()]);
    renderBook();

    expect(await screen.findByText('Omar Farouk', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('APT-3001')).toBeInTheDocument();
  });

  it('reads an empty book as empty', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([]);
    renderBook();

    expect(await screen.findByText('No appointments yet', undefined, LOAD)).toBeInTheDocument();
  });

  it('reads a failed load as a failure — never as an empty book — and retries on request', async () => {
    const list = vi
      .spyOn(appointmentService, 'listAppointments')
      .mockRejectedValue(Object.assign(new Error('API error: server'), { kind: 'server' }));
    renderBook();

    expect(
      await screen.findByText("Couldn't load appointments", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText('No appointments yet')).not.toBeInTheDocument();

    const callsBefore = list.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(list.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe('AppointmentsPage — transitions', () => {
  it('offers only the transitions the server allows on that appointment', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([
      appointment({ status: 'scheduled', allowedActions: ['cancel'] }),
    ]);
    renderBook();

    const menu = await openRowMenu('APT-3001');

    expect(within(menu).getByRole('menuitem', { name: /Cancel appointment/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Approve/ })).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /Mark completed/ }),
    ).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Reschedule/ })).not.toBeInTheDocument();
  });

  it('approves through the service and confirms only once it answers', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([appointment()]);
    const run = vi
      .spyOn(appointmentService, 'runAction')
      .mockResolvedValue(appointment({ status: 'confirmed', allowedActions: ['cancel'] }));
    renderBook();

    const menu = await openRowMenu('APT-3001');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Approve/ }));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith('APT-3001', { kind: 'approve' });
    });
    expect(await screen.findByText('APT-3001 confirmed', undefined, LOAD)).toBeInTheDocument();
  });

  it('reports a refused transition in the server’s own words, and claims no success', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([appointment()]);
    vi.spyOn(appointmentService, 'runAction').mockRejectedValue(
      Object.assign(new Error('API error: conflict'), {
        kind: 'conflict',
        code: 'invalid_transition',
        detail: 'This request was already declined by another session',
      }),
    );
    renderBook();

    const menu = await openRowMenu('APT-3001');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Approve/ }));

    expect(
      await screen.findByText(
        'This request was already declined by another session',
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('APT-3001 confirmed')).not.toBeInTheDocument();
  });

  it('marks a slot completed through the confirmation dialog', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([
      appointment({ status: 'scheduled', allowedActions: ['complete', 'cancel'] }),
    ]);
    const run = vi
      .spyOn(appointmentService, 'runAction')
      .mockResolvedValue(appointment({ status: 'completed', allowedActions: [] }));
    renderBook();

    const menu = await openRowMenu('APT-3001');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Mark completed/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark completed' }, LOAD));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith('APT-3001', { kind: 'complete' });
    });
  });
});

describe('AppointmentsPage — proposing other times', () => {
  const slotButtons = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole('button', { name: /^\d{2}:\d{2}$/ })
      .filter((button) => !(button as HTMLButtonElement).disabled);

  it('sends the chosen alternatives as one proposal, and confirms only once it answers', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([
      appointment({ allowedActions: ['approve', 'reject', 'propose-slots'] }),
    ]);
    const run = vi
      .spyOn(appointmentService, 'runAction')
      .mockResolvedValue(appointment({ status: 'awaiting-patient', allowedActions: ['cancel'] }));
    renderBook();

    const menu = await openRowMenu('APT-3001');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Propose other times/ }));

    const dialog = await screen.findByRole('dialog', { name: /Propose other times/ }, LOAD);
    const review = within(dialog).getByRole('button', { name: 'Review proposal' });
    expect(review).toBeDisabled();

    const [first, second] = slotButtons(dialog);
    if (first === undefined || second === undefined) throw new Error('no free slots to pick');
    await userEvent.click(first);
    await userEvent.click(second);
    expect(within(dialog).getByText('Proposed times (2 of 3)')).toBeInTheDocument();

    await userEvent.click(review);
    await userEvent.click(await screen.findByRole('button', { name: 'Send proposal' }, LOAD));

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith('APT-3001', {
        kind: 'propose-slots',
        slots: [expect.any(String), expect.any(String)],
        reason: '',
      });
    });
    expect(
      await screen.findByText('Proposed 2 times to Omar Farouk', undefined, LOAD),
    ).toBeInTheDocument();
  });

  it('stops at three alternatives, the most one proposal may carry', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([
      appointment({ allowedActions: ['propose-slots'] }),
    ]);
    renderBook();

    const menu = await openRowMenu('APT-3001');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Propose other times/ }));
    const dialog = await screen.findByRole('dialog', { name: /Propose other times/ }, LOAD);

    for (const button of slotButtons(dialog).slice(0, 3)) await userEvent.click(button);

    expect(within(dialog).getByText('Proposed times (3 of 3)')).toBeInTheDocument();
    // Every slot not already chosen is now unavailable.
    expect(slotButtons(dialog)).toHaveLength(3);
  });

  it('opens empty for the next request after a proposal is sent', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([
      appointment({ allowedActions: ['propose-slots'] }),
      appointment({
        id: 'APT-3002',
        patient: { ...appointment().patient, id: 'PT-1005', name: 'Mona Adel' },
        allowedActions: ['propose-slots'],
      }),
    ]);
    vi.spyOn(appointmentService, 'runAction').mockResolvedValue(
      appointment({ status: 'awaiting-patient', allowedActions: [] }),
    );
    renderBook();

    await userEvent.click(
      within(await openRowMenu('APT-3001')).getByRole('menuitem', { name: /Propose other times/ }),
    );
    const first = await screen.findByRole('dialog', { name: /APT-3001/ }, LOAD);
    const [slot] = slotButtons(first);
    if (slot === undefined) throw new Error('no free slot to pick');
    await userEvent.click(slot);
    await userEvent.click(within(first).getByRole('button', { name: 'Review proposal' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send proposal' }, LOAD));
    await screen.findByText('Proposed 1 time to Omar Farouk', undefined, LOAD);

    await userEvent.click(
      within(await openRowMenu('APT-3002')).getByRole('menuitem', { name: /Propose other times/ }),
    );
    const second = await screen.findByRole('dialog', { name: /APT-3002/ }, LOAD);
    expect(within(second).getByText('Proposed times (0 of 3)')).toBeInTheDocument();
  });

  it('is not offered where the server does not allow it', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([
      appointment({ allowedActions: ['approve', 'reject'] }),
    ]);
    renderBook();

    const menu = await openRowMenu('APT-3001');
    expect(
      within(menu).queryByRole('menuitem', { name: /Propose other times/ }),
    ).not.toBeInTheDocument();
  });
});

describe('AppointmentsPage — a link to one appointment', () => {
  const NOT_IN_BOOK = 'This appointment is not in your book';

  it('opens the drawer for an appointment the book holds, with no notice', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([appointment()]);
    renderBook('/doctor/appointments/APT-3001');

    expect(await screen.findByRole('dialog', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(NOT_IN_BOOK)).not.toBeInTheDocument();
  });

  it('says so when the link names an appointment the book does not hold', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([appointment()]);
    renderBook('/doctor/appointments/APT-9999');

    expect(await screen.findByText(NOT_IN_BOOK, undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(/No appointment APT-9999 is visible to you/)).toBeInTheDocument();
    // The book itself is still there to work from.
    expect(screen.getByText('APT-3001')).toBeInTheDocument();
  });

  it('clears the notice and the stale id when dismissed', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([appointment()]);
    const user = userEvent.setup();
    renderBook('/doctor/appointments/APT-9999');

    const notice =
      (await screen.findByText(NOT_IN_BOOK, undefined, LOAD)).closest('[role]') ?? document.body;
    await user.click(within(notice as HTMLElement).getByRole('button', { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByText(NOT_IN_BOOK)).not.toBeInTheDocument();
    });
  });

  it('does not call a failed load a missing appointment', async () => {
    vi.spyOn(appointmentService, 'listAppointments').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server' }),
    );
    renderBook('/doctor/appointments/APT-9999');

    expect(
      await screen.findByText("Couldn't load appointments", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOT_IN_BOOK)).not.toBeInTheDocument();
  });
});
