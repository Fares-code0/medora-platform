import { beforeEach, describe, expect, it } from 'vitest';

import type { OversightAppointment } from '../oversight.types';

import {
  DEFAULT_OVERSIGHT,
  oversightApi,
  OversightError,
  type OversightDocument,
} from './oversight.api';

/**
 * The oversight service (ADM-05).
 *
 * The claim under test is the one §3.5 is strict about: an intervention
 * either happens completely — history, roster and notifications together —
 * or not at all. A rejected reassignment that has already told a patient
 * their doctor changed is worse than no reassignment at all, so the failure
 * paths are tested as carefully as the success paths.
 */

const STORAGE_KEY = 'medora.admin.appointments.v1';

/** APT-2401 · pending · Dr. Omar Khalil (doc-khalil) · Cardiology. */
const PENDING_CARDIOLOGY = 'apt-2401';
/** APT-2403 · pending · Dr. Amira Hassan (doc-hassan) · Endocrinology. */
const PENDING_ENDOCRINOLOGY = 'apt-2403';
/** APT-2407 · completed · Dr. Amelia Chen. */
const COMPLETED = 'apt-2407';
/** APT-2404 · confirmed · Dr. Amelia Chen · General Medicine. */
const CONFIRMED_GENERAL = 'apt-2404';

const ACTOR = 'Marcus Reed';

function find(document: OversightDocument, id: string): OversightAppointment {
  const appointment = document.appointments.find((entry) => entry.id === id);
  if (appointment === undefined) throw new Error(`Fixture ${id} is missing from the seed.`);
  return appointment;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('reads', () => {
  it('serves the seeded baseline when nothing is stored', async () => {
    await expect(oversightApi.list()).resolves.toEqual(DEFAULT_OVERSIGHT);
  });

  it('falls back to the baseline when storage holds junk', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json');

    await expect(oversightApi.list()).resolves.toEqual(DEFAULT_OVERSIGHT);
  });
});

describe('nudging', () => {
  it('records the reminder on the appointment and notifies the doctor', async () => {
    const before = find(DEFAULT_OVERSIGHT, PENDING_CARDIOLOGY);

    const next = await oversightApi.nudge({
      ids: [PENDING_CARDIOLOGY],
      actor: ACTOR,
      message: 'APT-2401 has been awaiting your response for 2 d.',
    });
    const after = find(next, PENDING_CARDIOLOGY);

    expect(after.lastNudgedAt).not.toBeNull();
    expect(after.events[0]).toMatchObject({ kind: 'nudged', actor: ACTOR, actorRole: 'administrator' });
    expect(after.notifications[0]).toMatchObject({ party: 'doctor', status: 'delivered' });
    expect(after.notifications.length).toBe(before.notifications.length + 1);
    // The status is untouched: a nudge asks, it does not decide.
    expect(after.status).toBe('pending');
  });

  it('survives a reload', async () => {
    await oversightApi.nudge({ ids: [PENDING_CARDIOLOGY], actor: ACTOR, message: 'Please respond.' });

    const reloaded = await oversightApi.list();

    expect(find(reloaded, PENDING_CARDIOLOGY).lastNudgedAt).not.toBeNull();
  });

  it('skips ineligible ids rather than failing the whole batch', async () => {
    const next = await oversightApi.nudge({
      ids: [PENDING_CARDIOLOGY, COMPLETED],
      actor: ACTOR,
      message: 'Please respond.',
    });

    expect(find(next, PENDING_CARDIOLOGY).lastNudgedAt).not.toBeNull();
    expect(find(next, COMPLETED).lastNudgedAt).toBeNull();
    expect(find(next, COMPLETED).events).toEqual(find(DEFAULT_OVERSIGHT, COMPLETED).events);
  });

  it('refuses a batch with nothing nudgeable in it', async () => {
    await expect(
      oversightApi.nudge({ ids: [COMPLETED], actor: ACTOR, message: 'Please respond.' }),
    ).rejects.toBeInstanceOf(OversightError);

    // And wrote nothing on the way out.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('reassignment', () => {
  const REASON = 'Dr. Khalil is on emergency cover until Thursday.';

  it('moves the appointment, restarts the clock and notifies all three parties', async () => {
    const next = await oversightApi.reassign({
      id: PENDING_CARDIOLOGY,
      toDoctorId: 'doc-nabil',
      actor: ACTOR,
      reason: REASON,
    });
    const after = find(next, PENDING_CARDIOLOGY);

    expect(after.doctorId).toBe('doc-nabil');
    expect(after.doctorName).toBe('Dr. Youssef Nabil');
    // The receiving doctor has not been sitting on this request.
    expect(new Date(after.stateSince).getTime()).toBeGreaterThan(
      new Date(find(DEFAULT_OVERSIGHT, PENDING_CARDIOLOGY).stateSince).getTime(),
    );
    expect(after.events[0]).toMatchObject({ kind: 'reassigned', actor: ACTOR });
    expect(after.events[0]?.detail).toContain(REASON);

    const parties = after.notifications.slice(0, 3).map((entry) => entry.party);
    expect(parties).toEqual(['patient', 'receiving-doctor', 'doctor']);
  });

  it('consumes a slot on the receiving doctor', async () => {
    const before = DEFAULT_OVERSIGHT.doctors.find((entry) => entry.id === 'doc-nabil');

    const next = await oversightApi.reassign({
      id: PENDING_CARDIOLOGY,
      toDoctorId: 'doc-nabil',
      actor: ACTOR,
      reason: REASON,
    });

    const after = next.doctors.find((entry) => entry.id === 'doc-nabil');
    expect(after?.openSlotsToday).toBe((before?.openSlotsToday ?? 1) - 1);
  });

  it('refuses a doctor of another specialty and changes nothing', async () => {
    await expect(
      oversightApi.reassign({
        id: PENDING_CARDIOLOGY,
        toDoctorId: 'doc-chen',
        actor: ACTOR,
        reason: REASON,
      }),
    ).rejects.toThrow(/General Medicine/);

    const unchanged = await oversightApi.list();
    const appointment = find(unchanged, PENDING_CARDIOLOGY);
    expect(appointment.doctorId).toBe('doc-khalil');
    expect(appointment.notifications).toEqual(
      find(DEFAULT_OVERSIGHT, PENDING_CARDIOLOGY).notifications,
    );
  });

  it('refuses a doctor with no capacity and notifies no one', async () => {
    await expect(
      oversightApi.reassign({
        id: PENDING_ENDOCRINOLOGY,
        toDoctorId: 'doc-said',
        actor: ACTOR,
        reason: 'Dr. Hassan is fully booked this week.',
      }),
    ).rejects.toThrow(/no capacity/);

    const unchanged = await oversightApi.list();
    expect(find(unchanged, PENDING_ENDOCRINOLOGY).doctorId).toBe('doc-hassan');
    expect(find(unchanged, PENDING_ENDOCRINOLOGY).events).toEqual(
      find(DEFAULT_OVERSIGHT, PENDING_ENDOCRINOLOGY).events,
    );
    // Nothing was persisted at all — the write never started.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('refuses an appointment that is already closed', async () => {
    await expect(
      oversightApi.reassign({
        id: COMPLETED,
        toDoctorId: 'doc-ibrahim',
        actor: ACTOR,
        reason: 'Trying to move a finished visit.',
      }),
    ).rejects.toThrow(/completed/);
  });

  it('refuses to reassign an appointment to the doctor who already holds it', async () => {
    await expect(
      oversightApi.reassign({
        id: CONFIRMED_GENERAL,
        toDoctorId: 'doc-chen',
        actor: ACTOR,
        reason: 'A no-op reassignment.',
      }),
    ).rejects.toThrow(/already with/);
  });
});

describe('administrative cancellation', () => {
  const REASON = 'Cardiology clinic closed Thursday for the power works.';

  it('cancels, attributes the decision, and sends the apology to the patient', async () => {
    const next = await oversightApi.cancelAdministratively({
      id: CONFIRMED_GENERAL,
      category: 'clinic-closure',
      actor: ACTOR,
      reason: REASON,
    });
    const after = find(next, CONFIRMED_GENERAL);

    expect(after.status).toBe('cancelled');
    expect(after.events[0]).toMatchObject({
      kind: 'cancelled-administratively',
      actor: ACTOR,
      actorRole: 'administrator',
    });
    expect(after.events[0]?.detail).toContain('clinic-closure');
    expect(after.events[0]?.detail).toContain(REASON);

    const patientNotice = after.notifications[0];
    expect(patientNotice?.party).toBe('patient');
    expect(patientNotice?.subject).toMatch(/sorry/i);
    // The receipt names the appointment, never the patient.
    expect(patientNotice?.recipientLabel).toBe('Patient · APT-2404');
  });

  it('refuses to cancel something already closed', async () => {
    await expect(
      oversightApi.cancelAdministratively({
        id: COMPLETED,
        category: 'duplicate-booking',
        actor: ACTOR,
        reason: 'Cancelling a completed visit.',
      }),
    ).rejects.toBeInstanceOf(OversightError);
  });
});

describe('reset', () => {
  it('restores the seeded baseline', async () => {
    await oversightApi.nudge({ ids: [PENDING_CARDIOLOGY], actor: ACTOR, message: 'Please respond.' });

    await oversightApi.reset();

    await expect(oversightApi.list()).resolves.toEqual(DEFAULT_OVERSIGHT);
  });
});
