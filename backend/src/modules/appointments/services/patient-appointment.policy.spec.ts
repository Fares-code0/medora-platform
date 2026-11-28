import { describe, expect, it } from 'vitest';

import type { AppointmentStatus } from '../../../generated/prisma/enums';

import {
  cancelRefusal,
  patientAvailableActions,
  patientCancelledReason,
  rescheduleRefusal,
  type PatientActionFacts,
} from './patient-appointment.policy';

/**
 * ADR-049's patient rule, without a database or a clock: who may cancel,
 * who may request a reschedule, and that `availableActions` is exactly
 * the union of the two write-route answers.
 */
const NOW = new Date('2027-03-01T10:00:00.000Z');
const FUTURE = new Date('2027-03-01T10:00:00.001Z');
const AT_START = NOW;
const PAST = new Date('2027-03-01T09:59:59.999Z');

function facts(overrides: Partial<PatientActionFacts> = {}): PatientActionFacts {
  return {
    status: 'CONFIRMED',
    startsAt: FUTURE,
    hasHospital: true,
    hasPendingRequest: false,
    ...overrides,
  };
}

const ALL: readonly AppointmentStatus[] = [
  'PENDING',
  'SCHEDULED',
  'CONFIRMED',
  'RESCHEDULED',
  'AWAITING_PATIENT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

describe('cancelRefusal', () => {
  it.each([
    ['PENDING', true],
    ['SCHEDULED', true],
    ['CONFIRMED', true],
    ['RESCHEDULED', true],
    ['AWAITING_PATIENT', true],
    ['COMPLETED', false],
    ['CANCELLED', false],
    ['NO_SHOW', false],
  ] as const)('%s before the start → allowed: %s', (status, allowed) => {
    expect(cancelRefusal({ status, startsAt: FUTURE }, NOW) === null).toBe(allowed);
  });

  it('refuses at and after the start time, for every live status', () => {
    for (const status of ALL) {
      expect(cancelRefusal({ status, startsAt: AT_START }, NOW)).not.toBeNull();
      expect(cancelRefusal({ status, startsAt: PAST }, NOW)).not.toBeNull();
    }
  });
});

describe('rescheduleRefusal', () => {
  it.each([
    ['PENDING', false],
    ['SCHEDULED', true],
    ['CONFIRMED', true],
    ['RESCHEDULED', true],
    ['AWAITING_PATIENT', false],
    ['COMPLETED', false],
    ['CANCELLED', false],
    ['NO_SHOW', false],
  ] as const)('%s → allowed: %s', (status, allowed) => {
    expect(rescheduleRefusal(facts({ status }), NOW) === null).toBe(allowed);
  });

  it('refuses once the appointment has started', () => {
    expect(rescheduleRefusal(facts({ startsAt: AT_START }), NOW)).not.toBeNull();
  });

  it('refuses a legacy appointment with no hospital', () => {
    expect(rescheduleRefusal(facts({ hasHospital: false }), NOW)).not.toBeNull();
  });

  it('refuses a second request while one is pending', () => {
    expect(rescheduleRefusal(facts({ hasPendingRequest: true }), NOW)).toMatch(/already pending/);
  });
});

describe('patientAvailableActions', () => {
  it('offers both actions on a future confirmed appointment', () => {
    expect(patientAvailableActions(facts(), NOW)).toEqual(['cancel', 'reschedule']);
  });

  it('offers only cancel on a pending request and while a reschedule is pending', () => {
    expect(patientAvailableActions(facts({ status: 'PENDING' }), NOW)).toEqual(['cancel']);
    expect(patientAvailableActions(facts({ hasPendingRequest: true }), NOW)).toEqual(['cancel']);
  });

  it('offers nothing on a terminal or started appointment', () => {
    expect(patientAvailableActions(facts({ status: 'CANCELLED' }), NOW)).toEqual([]);
    expect(patientAvailableActions(facts({ startsAt: PAST }), NOW)).toEqual([]);
  });

  it('agrees with the write-route refusals for every status and time', () => {
    for (const status of ALL) {
      for (const startsAt of [FUTURE, AT_START, PAST]) {
        const f = facts({ status, startsAt });
        const actions = patientAvailableActions(f, NOW);
        expect(actions.includes('cancel')).toBe(cancelRefusal(f, NOW) === null);
        expect(actions.includes('reschedule')).toBe(rescheduleRefusal(f, NOW) === null);
      }
    }
  });
});

describe('patientCancelledReason', () => {
  it('stores the closed code, with the note when given', () => {
    expect(patientCancelledReason('transport')).toBe('patient:transport');
    expect(patientCancelledReason('other', '  ')).toBe('patient:other');
    expect(patientCancelledReason('other', 'Travelling')).toBe('patient:other — Travelling');
  });

  it('fits the 300-character column with the longest note the schema admits', () => {
    expect(patientCancelledReason('schedule_conflict', 'x'.repeat(200)).length).toBeLessThanOrEqual(300);
  });
});
