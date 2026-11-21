import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import type { AppointmentCommand } from '../model/appointment-service';
import { availableActions } from '../model/types';

import { httpAppointmentService } from './http-appointment-service';

/**
 * The appointment book over HTTP (FE-10.3), against `AppointmentView`
 * bodies captured from `GET /appointments` on a seeded database.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function appointmentView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'APT-3000',
    patient: {
      id: 'PT-1003',
      name: 'Amira Saleh',
      mrn: '4468-12',
      phone: '+20 122 574 9911',
      age: 34,
      gender: 'female',
    },
    dateTime: '2026-10-04T12:00:00.000Z',
    durationMin: 30,
    visitType: 'Lab review',
    department: 'General Medicine',
    doctorId: '545e8b20-0997-4fcb-860e-5b37042be266',
    doctor: 'Dr. Amelia Chen',
    status: 'scheduled',
    priority: 'normal',
    isNewPatient: false,
    isFollowUp: false,
    reason: 'Routine review',
    notes: null,
    availableActions: ['complete', 'no-show', 'reschedule', 'cancel'],
    ...overrides,
  };
}

describe('httpAppointmentService.listAppointments', () => {
  it('maps the backend projection, keeping the server’s allowed actions', async () => {
    stubApi({ 'GET /appointments': () => pageOf([appointmentView()]) });

    const [appointment] = await httpAppointmentService.listAppointments();

    expect(appointment).toMatchObject({
      id: 'APT-3000',
      patient: { id: 'PT-1003', name: 'Amira Saleh', gender: 'female' },
      department: 'General Medicine',
      status: 'scheduled',
      allowedActions: ['complete', 'no-show', 'reschedule', 'cancel'],
    });
  });

  it('lets the server, not the local machine, decide what the row offers', async () => {
    // A future slot the local machine would offer only reschedule/cancel on;
    // the server says complete is allowed, so complete is what is offered.
    stubApi({
      'GET /appointments': () =>
        pageOf([
          appointmentView({ dateTime: '2099-01-01T09:00:00.000Z', availableActions: ['complete'] }),
        ]),
    });

    const [appointment] = await httpAppointmentService.listAppointments();

    expect(appointment && availableActions(appointment)).toEqual(['complete']);
  });

  it('keeps propose-slots, which now has a flow, on a pending request', async () => {
    stubApi({
      'GET /appointments': () =>
        pageOf([
          appointmentView({
            status: 'pending',
            availableActions: ['approve', 'reject', 'propose-slots'],
          }),
        ]),
    });

    const [appointment] = await httpAppointmentService.listAppointments();

    expect(appointment?.allowedActions).toEqual(['approve', 'reject', 'propose-slots']);
  });

  it('drops an action this screen has no flow for, rather than offering a dead button', async () => {
    stubApi({
      'GET /appointments': () =>
        pageOf([
          appointmentView({
            status: 'pending',
            availableActions: ['approve', 'reject', 'teleport'],
          }),
        ]),
    });

    const [appointment] = await httpAppointmentService.listAppointments();

    expect(appointment?.allowedActions).toEqual(['approve', 'reject']);
  });

  it('shows an appointment with no department as "—", not a guessed one', async () => {
    stubApi({ 'GET /appointments': () => pageOf([appointmentView({ department: null })]) });

    const [appointment] = await httpAppointmentService.listAppointments();

    expect(appointment?.department).toBe('—');
  });

  it('reads the awaiting-patient status the frontend used not to know', async () => {
    stubApi({
      'GET /appointments': () => pageOf([appointmentView({ status: 'awaiting-patient' })]),
    });

    const [appointment] = await httpAppointmentService.listAppointments();

    expect(appointment?.status).toBe('awaiting-patient');
  });

  it('answers an empty book with an empty list, sorted ascending on the server', async () => {
    const { requests } = stubApi({ 'GET /appointments': () => pageOf([]) });

    await expect(httpAppointmentService.listAppointments()).resolves.toEqual([]);
    expect(requests[0]?.query.get('sort')).toBe('startsAt:asc');
  });

  it('rejects a server failure instead of answering an empty book', async () => {
    stubApi({ 'GET /appointments': () => json({ message: 'boom' }, 500) });

    await expect(httpAppointmentService.listAppointments()).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('httpAppointmentService.runAction — one endpoint per transition', () => {
  const cases: readonly [AppointmentCommand, string, unknown][] = [
    [{ kind: 'approve' }, '/appointments/APT-3000/approve', undefined],
    [
      { kind: 'reject', category: 'schedule_conflict', detail: '  ' },
      '/appointments/APT-3000/reject',
      { reasonCategory: 'schedule_conflict' },
    ],
    [
      { kind: 'reject', category: 'other', detail: 'Referred elsewhere' },
      '/appointments/APT-3000/reject',
      { reasonCategory: 'other', reason: 'Referred elsewhere' },
    ],
    [
      { kind: 'cancel', reason: 'Doctor unavailable' },
      '/appointments/APT-3000/cancel',
      { reason: 'Doctor unavailable' },
    ],
    [
      { kind: 'reschedule', dateTime: '2026-10-09T08:00:00.000Z', reason: 'Clinic closed' },
      '/appointments/APT-3000/reschedule',
      { dateTime: '2026-10-09T08:00:00.000Z', reason: 'Clinic closed' },
    ],
    [
      {
        kind: 'propose-slots',
        slots: ['2026-10-09T08:00:00.000Z', '2026-10-10T09:30:00.000Z'],
        reason: '   ',
      },
      '/appointments/APT-3000/propose-slots',
      { slots: ['2026-10-09T08:00:00.000Z', '2026-10-10T09:30:00.000Z'] },
    ],
    [
      { kind: 'propose-slots', slots: ['2026-10-09T08:00:00.000Z'], reason: 'Morning is full' },
      '/appointments/APT-3000/propose-slots',
      { slots: ['2026-10-09T08:00:00.000Z'], reason: 'Morning is full' },
    ],
    [{ kind: 'complete' }, '/appointments/APT-3000/complete', undefined],
    [{ kind: 'no-show' }, '/appointments/APT-3000/no-show', undefined],
  ];

  it.each(cases)('%j posts to the right route with the right body', async (command, path, body) => {
    const { requests } = stubApi({
      [`POST ${path}`]: () => envelope(appointmentView({ status: 'confirmed' })),
    });

    const updated = await httpAppointmentService.runAction('APT-3000', command);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual(body);
    expect(updated.status).toBe('confirmed');
  });

  it('reports a refused transition with the server’s reason', async () => {
    stubApi({
      'POST /appointments/APT-3000/reschedule': () =>
        json(
          {
            message: 'Conflict',
            code: 'slot_conflict',
            detail: 'The slot falls outside the doctor’s working hours',
          },
          409,
        ),
    });

    await expect(
      httpAppointmentService.runAction('APT-3000', {
        kind: 'reschedule',
        dateTime: '2026-10-09T05:00:00.000Z',
        reason: 'Earlier slot',
      }),
    ).rejects.toMatchObject({
      kind: 'conflict',
      code: 'slot_conflict',
      detail: 'The slot falls outside the doctor’s working hours',
    });
  });
});

describe('httpAppointmentService.createAppointment', () => {
  it('sends the booking contract — the patient by id, the server books the caller', async () => {
    const { requests } = stubApi({
      'POST /appointments': () => json(envelope(appointmentView()), 201),
    });

    await httpAppointmentService.createAppointment({
      patient: {
        id: 'PT-1003',
        name: 'Amira Saleh',
        mrn: '4468-12',
        phone: '+20 1',
        age: 34,
        gender: 'female',
      },
      dateTime: '2026-10-04T12:00:00.000Z',
      durationMin: 30,
      visitType: 'Follow-up',
      department: 'General Medicine',
      doctor: 'ignored by the server',
      priority: 'normal',
      reason: 'BP review',
    });

    expect(requests[0]?.body).toEqual({
      patientId: 'PT-1003',
      dateTime: '2026-10-04T12:00:00.000Z',
      durationMin: 30,
      visitType: 'Follow-up',
      department: 'General Medicine',
      priority: 'normal',
      reason: 'BP review',
      isFollowUp: true,
    });
    // No intent key given, none sent — the request is exactly as before.
    expect(requests[0]?.headers['Idempotency-Key']).toBeUndefined();
  });

  it('sends the booking intent as Idempotency-Key, so a retry cannot book twice', async () => {
    const { requests } = stubApi({
      'POST /appointments': () => json(envelope(appointmentView()), 201),
    });

    await httpAppointmentService.createAppointment({
      patient: { id: 'PT-1003', name: 'A', mrn: '1', phone: '', age: 34, gender: 'female' },
      dateTime: '2026-10-04T12:00:00.000Z',
      durationMin: 30,
      visitType: 'Consultation',
      department: 'General Medicine',
      doctor: 'ignored by the server',
      priority: 'normal',
      reason: 'BP review',
      idempotencyKey: 'booking-intent-1',
    });

    expect(requests[0]?.headers['Idempotency-Key']).toBe('booking-intent-1');
    expect(requests[0]?.body).not.toHaveProperty('idempotencyKey');
  });

  it('declares that availability is the server’s to decide', () => {
    expect(httpAppointmentService.capabilities.simulatedBusySlots).toBe(false);
  });
});
