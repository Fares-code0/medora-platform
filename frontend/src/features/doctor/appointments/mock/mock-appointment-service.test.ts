import { describe, expect, it } from 'vitest';

import { MOCK_APPOINTMENTS } from '../model/mock-data';
import { availableActions, type Appointment } from '../model/types';

import { mockAppointmentService } from './mock-appointment-service';

/**
 * The mock appointment book (FE-10.3): each command makes the status change
 * the old patch-based store made, and an appointment that carries no
 * server-allowed actions falls back to the local status machine.
 */

function seeded(status: Appointment['status']): Appointment {
  const found = MOCK_APPOINTMENTS.find((candidate) => candidate.status === status);
  if (found === undefined) throw new Error(`no seeded ${status} appointment`);
  return found;
}

describe('mockAppointmentService.runAction', () => {
  it('approves a request into confirmed', async () => {
    const { id } = seeded('pending');
    await expect(mockAppointmentService.runAction(id, { kind: 'approve' })).resolves.toMatchObject({
      status: 'confirmed',
    });
  });

  it('records a declined request’s category and detail in its notes', async () => {
    const { id } = seeded('pending');
    const updated = await mockAppointmentService.runAction(id, {
      kind: 'reject',
      category: 'outside_specialty',
      detail: 'Refer to cardiology',
    });
    expect(updated).toMatchObject({
      status: 'cancelled',
      notes: 'Rejected: Outside my specialty — Refer to cardiology',
    });
  });

  it('moves a rescheduled appointment to its new time', async () => {
    const { id } = seeded('scheduled');
    const updated = await mockAppointmentService.runAction(id, {
      kind: 'reschedule',
      dateTime: '2099-01-02T09:00:00.000Z',
      reason: 'Clinic closed',
    });
    expect(updated).toMatchObject({ status: 'rescheduled', dateTime: '2099-01-02T09:00:00.000Z' });
  });

  it('answers a pending request with alternatives, which then wait on the patient', async () => {
    const pending = (await mockAppointmentService.listAppointments()).find(
      (candidate) => candidate.status === 'pending',
    );
    if (pending === undefined) throw new Error('no pending appointment left in the book');

    const updated = await mockAppointmentService.runAction(pending.id, {
      kind: 'propose-slots',
      slots: ['2099-01-02T09:00:00.000Z', '2099-01-03T10:30:00.000Z'],
      reason: 'Fully booked that morning',
    });

    expect(updated.status).toBe('awaiting-patient');
    expect(updated.dateTime).toBe(pending.dateTime);
    expect(updated.notes).toMatch(/^Proposed: .+; .+ — Fully booked that morning$/);
  });

  it('refuses a proposal on anything but a pending request, as the API does', async () => {
    const { id } = seeded('completed');
    await expect(
      mockAppointmentService.runAction(id, {
        kind: 'propose-slots',
        slots: ['2099-01-02T09:00:00.000Z'],
        reason: '',
      }),
    ).rejects.toThrow(/Only a pending request/);
  });

  it('refuses an id it does not hold', async () => {
    await expect(
      mockAppointmentService.runAction('APT-NOPE', { kind: 'complete' }),
    ).rejects.toThrow(/Unknown appointment/);
  });
});

describe('availableActions — local machine when the source sends none', () => {
  const base = seeded('pending');

  it('offers approve, propose other times and reject on a request — the API’s own set', () => {
    expect(availableActions({ ...base, status: 'pending', allowedActions: undefined })).toEqual([
      'approve',
      'propose-slots',
      'reject',
    ]);
  });

  it('lets an outstanding proposal be resolved but not re-proposed', () => {
    expect(
      availableActions({ ...base, status: 'awaiting-patient', allowedActions: undefined }),
    ).toEqual(['reschedule', 'cancel']);
  });

  it('offers nothing on a terminal status', () => {
    expect(availableActions({ ...base, status: 'completed', allowedActions: undefined })).toEqual(
      [],
    );
  });

  it('defers to the server’s list whenever one is present, even an empty one', () => {
    expect(availableActions({ ...base, status: 'pending', allowedActions: [] })).toEqual([]);
  });
});
