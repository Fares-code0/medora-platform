import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import {
  httpOversightService,
  toOversightAppointment,
  toOversightSummary,
  toPlatformDoctor,
} from './http-oversight-service';

/** Appointment oversight over HTTP (FE-10.10) — API §5.10–5.11. */

afterEach(() => {
  vi.unstubAllGlobals();
});

function rowView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'APT-10001',
    reference: 'APT-10001',
    startsAt: '2026-10-06T09:00:00.000Z',
    durationMin: 30,
    visitType: 'Consultation',
    department: null,
    specialty: 'Cardiology',
    doctorId: 'doc-uuid-1',
    doctorName: 'Dr. Omar Khalil',
    patientId: 'PT-1003',
    status: 'pending',
    stateSince: '2026-10-03T09:00:00.000Z',
    ageInStateHours: 72,
    rescheduleCount: 0,
    lastNudgedAt: null,
    flags: ['stuck-pending'],
    ...overrides,
  };
}

function doctorView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-uuid-2',
    fullName: 'Dr. Salma Ibrahim',
    title: null,
    specialty: 'Cardiology',
    departmentName: 'Cardiology',
    licenseNumber: 'GM-1',
    licenseExpiresOn: null,
    professionalCategory: null,
    verificationStatus: 'verified',
    practiceStatus: 'active',
    ratingAvg: 4.6,
    lastActiveAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    patientsCount: 0,
    appointments30d: 0,
    ...overrides,
  };
}

describe('mapping', () => {
  it('withholds the patient identity the server never sends', () => {
    expect(toOversightAppointment(rowView())).toMatchObject({
      id: 'APT-10001',
      department: '—',
      patientId: 'PT-1003',
      patientName: null,
      patientMrn: null,
      complaint: null,
      events: [],
      notifications: [],
    });
  });

  it('reads the server’s awaiting-patient status', () => {
    expect(toOversightAppointment(rowView({ status: 'awaiting-patient' })).status).toBe(
      'awaiting-patient',
    );
    expect(() => toOversightAppointment(rowView({ status: 'lost' }))).toThrow();
  });

  it('leaves reassignment capacity unknown rather than inventing it', () => {
    expect(toPlatformDoctor(doctorView())).toMatchObject({
      availability: 'unknown',
      openSlotsToday: null,
      loadPercent: null,
      note: null,
    });
    expect(toPlatformDoctor(doctorView({ practiceStatus: 'vacation' }))).toMatchObject({
      availability: 'unavailable',
      note: 'On vacation',
    });
  });

  it('renders the server’s rate fractions as one-decimal percents', () => {
    expect(
      toOversightSummary({
        today: 4,
        pending: 2,
        upcoming: 9,
        completedThisWeek: 3,
        pendingOverDay: 1,
        cancellationRate7d: 0.125,
        noShowRate7d: 0.0333,
        window7dTotal: 30,
      }),
    ).toEqual({
      todayTotal: 4,
      pendingOverThreshold: 1,
      cancellationRate7d: 12.5,
      noShowRate7d: 3.3,
      window7dTotal: 30,
    });
  });
});

describe('httpOversightService', () => {
  it('reads the whole book and the roster together', async () => {
    const { requests } = stubApi({
      'GET /admin/appointments': () => pageOf([rowView()]),
      'GET /doctors': () => pageOf([doctorView()]),
    });
    const document = await httpOversightService.list();
    expect(document.appointments).toHaveLength(1);
    expect(document.doctors[0]?.name).toBe('Dr. Salma Ibrahim');
    const book = requests.find((request) => request.path === '/admin/appointments');
    expect(book?.query.get('sort')).toBe('startsAt:asc');
  });

  it('fails the load when either half is refused', async () => {
    stubApi({
      'GET /admin/appointments': () => pageOf([rowView()]),
      'GET /doctors': () => json({ code: 'forbidden', message: 'Forbidden' }, 403),
    });
    await expect(httpOversightService.list()).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('reads the KPI strip from the summary route', async () => {
    stubApi({
      'GET /admin/appointments/summary': () =>
        envelope({
          today: 0,
          pending: 0,
          upcoming: 0,
          completedThisWeek: 0,
          pendingOverDay: 0,
          cancellationRate7d: 0,
          noShowRate7d: 0,
          window7dTotal: 0,
        }),
    });
    await expect(httpOversightService.summary()).resolves.toMatchObject({ window7dTotal: 0 });
  });

  it('nudges one row at a time with the server’s template', async () => {
    const { requests } = stubApi({
      'POST /admin/appointments/APT-1/nudge': () => envelope(rowView({ id: 'APT-1' })),
      'POST /admin/appointments/APT-2/nudge': () => envelope(rowView({ id: 'APT-2' })),
    });
    await expect(
      httpOversightService.nudge({ ids: ['APT-1', 'APT-2'], actor: 'A', message: 'x' }),
    ).resolves.toBeNull();
    expect(requests.map((request) => request.body)).toEqual([
      { template: 'awaiting-confirmation' },
      { template: 'awaiting-confirmation' },
    ]);
  });

  it('says how many reminders went out when only some did', async () => {
    stubApi({
      'POST /admin/appointments/APT-1/nudge': () => envelope(rowView({ id: 'APT-1' })),
      'POST /admin/appointments/APT-2/nudge': () =>
        json(
          {
            code: 'nudge_cooldown',
            message: 'Conflict',
            detail: 'This appointment was nudged less than 60 minutes ago',
          },
          409,
        ),
    });
    await expect(
      httpOversightService.nudge({ ids: ['APT-1', 'APT-2'], actor: 'A', message: 'x' }),
    ).rejects.toThrow(
      '1 of 2 reminders were sent. The rest were refused: This appointment was nudged less than 60 minutes ago.',
    );
  });

  it('passes a single refusal through unchanged', async () => {
    stubApi({
      'POST /admin/appointments/APT-1/nudge': () =>
        json({ code: 'nudge_not_applicable', message: 'Conflict', detail: 'Completed' }, 409),
    });
    await expect(
      httpOversightService.nudge({ ids: ['APT-1'], actor: 'A', message: 'x' }),
    ).rejects.toMatchObject({ kind: 'conflict', detail: 'Completed' });
  });

  it('reassigns and cancels with the bodies the API validates', async () => {
    const { requests } = stubApi({
      'POST /admin/appointments/APT-1/reassign': () => envelope(rowView()),
      'POST /admin/appointments/APT-1/cancel-administratively': () => envelope(rowView()),
    });
    await httpOversightService.reassign({
      id: 'APT-1',
      toDoctorId: 'doc-uuid-2',
      actor: 'A',
      reason: '  On emergency cover until Thursday.  ',
    });
    await httpOversightService.cancelAdministratively({
      id: 'APT-1',
      category: 'clinic-closure',
      actor: 'A',
      reason: 'The clinic is closed for maintenance.',
    });
    expect(requests[0]?.body).toEqual({
      doctorId: 'doc-uuid-2',
      reason: 'On emergency cover until Thursday.',
    });
    expect(requests[1]?.body).toEqual({
      category: 'clinic-closure',
      reason: 'The clinic is closed for maintenance.',
    });
  });

  it('passes a reassignment refusal through for the dialog', async () => {
    stubApi({
      'POST /admin/appointments/APT-1/reassign': () =>
        json({ code: 'validation_failed', fieldErrors: { doctorId: ['Unknown doctor'] } }, 422),
    });
    await expect(
      httpOversightService.reassign({ id: 'APT-1', toDoctorId: 'x', actor: 'A', reason: 'r' }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('serves no history, and says so through its capabilities', () => {
    expect(httpOversightService.capabilities).toEqual({ history: false });
  });
});
