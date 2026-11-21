import { describe, expect, it } from 'vitest';

import type { AppException } from '../../../common/errors/app.exception';
import type { AppointmentStatus } from '../../../generated/prisma/enums';

import {
  appointmentStatusMachine,
  assertSlotDateArrived,
  availableActions,
} from './appointment-status.machine';

/**
 * The ADR-001 matrix, exhaustively.
 *
 * ADR-001's consequences ask for "every legal and illegal transition per
 * status × slot-date". That is 8 × 8 assertions for the table and a
 * separate pass for the clock, and the point of writing it out as a
 * table-driven sweep rather than as prose is that a ninth status cannot
 * quietly go untested — `appointmentStatusMachine.statuses` is the
 * source, so the sweep grows with the enum.
 */

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

/** ADR-001 §2, transcribed independently of the implementation. */
const LEGAL: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'AWAITING_PATIENT'],
  SCHEDULED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  CONFIRMED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  RESCHEDULED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  AWAITING_PATIENT: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

describe('the transition table', () => {
  it('covers every status in the enum', () => {
    expect([...appointmentStatusMachine.statuses].sort()).toEqual([...ALL].sort());
  });

  for (const from of ALL) {
    for (const to of ALL) {
      const legal = LEGAL[from].includes(to);

      it(`${legal ? 'allows' : 'refuses'} ${from} → ${to}`, () => {
        expect(appointmentStatusMachine.can(from, to)).toBe(legal);

        if (legal) {
          expect(() => {
            appointmentStatusMachine.assert(from, to);
          }).not.toThrow();

          return;
        }

        expect(() => {
          appointmentStatusMachine.assert(from, to);
        }).toThrowError();
      });
    }
  }

  it('treats the three terminal statuses as terminal', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(appointmentStatusMachine.isTerminal(status)).toBe(true);
    }
  });

  it('treats every other status as live', () => {
    // The other direction. `appointment.service.ts` and the oversight
    // service both refuse to touch a terminal row, so a status wrongly
    // reported terminal is an appointment nobody can move again.
    for (const status of ALL.filter((s) => LEGAL[s].length > 0)) {
      expect(appointmentStatusMachine.isTerminal(status)).toBe(false);
    }
  });

  it('lists exactly ADR-001’s targets from each status', () => {
    for (const status of ALL) {
      expect([...appointmentStatusMachine.allowedFrom(status)].sort()).toEqual(
        [...LEGAL[status]].sort(),
      );
    }
  });

  it('refuses a no-op transition', () => {
    // A client re-confirming an already-confirmed appointment is acting
    // on a view someone else has already moved — the lost-update race
    // 409 exists to report, not a harmless repeat.
    expect(appointmentStatusMachine.can('CONFIRMED', 'CONFIRMED')).toBe(false);
  });

  it('names the wire vocabulary in the 409 detail, never the Prisma member', () => {
    // API §11's header calls the kebab-case literals law; a `detail`
    // reading `NO_SHOW` names a vocabulary no client has.
    let thrown: AppException | null = null;
    try {
      appointmentStatusMachine.assert('NO_SHOW', 'COMPLETED');
    } catch (error) {
      thrown = error as AppException;
    }

    expect(thrown).not.toBeNull();
    expect(thrown?.detail).toContain('no-show');
    expect(thrown?.detail).not.toContain('NO_SHOW');
    expect(thrown?.code).toBe('invalid_status_transition');
  });

  it('refuses pending → scheduled, which only the trigger permits', () => {
    // The database trigger is a backstop and is deliberately looser. No
    // endpoint in API §5 performs this move, so the API does not offer it.
    expect(appointmentStatusMachine.can('PENDING', 'SCHEDULED')).toBe(false);
  });
});

describe('the slot-date gate', () => {
  const now = new Date('2026-09-14T12:00:00.000Z');

  it('allows completion once the slot date has arrived', () => {
    expect(() => {
      assertSlotDateArrived('COMPLETED', new Date('2026-09-14T09:00:00.000Z'), 'UTC', now);
    }).not.toThrow();
  });

  it('allows completion on a slot earlier the same day', () => {
    expect(() => {
      assertSlotDateArrived('COMPLETED', new Date('2026-09-14T23:00:00.000Z'), 'UTC', now);
    }).not.toThrow();
  });

  it('refuses completion before the slot date', () => {
    expect(() => {
      assertSlotDateArrived('COMPLETED', new Date('2026-09-15T09:00:00.000Z'), 'UTC', now);
    }).toThrowError();
  });

  it('refuses a no-show before the slot date', () => {
    expect(() => {
      assertSlotDateArrived('NO_SHOW', new Date('2026-09-15T09:00:00.000Z'), 'UTC', now);
    }).toThrowError();
  });

  it('gates nothing else', () => {
    for (const target of ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'] as const) {
      expect(() => {
        assertSlotDateArrived(target, new Date('2030-01-01T09:00:00.000Z'), 'UTC', now);
      }).not.toThrow();
    }
  });

  /**
   * The reason this comparison is not `Date.now() >= slot`.
   *
   * At 22:00 UTC on the 14th it is already the 15th in Tokyo. A clinic
   * there completing a visit booked for the 15th is describing something
   * that has happened; a UTC comparison would refuse it.
   */
  it('reads "today" in the clinic timezone', () => {
    const lateUtc = new Date('2026-09-14T22:00:00.000Z');
    const slot = new Date('2026-09-15T01:00:00.000Z');

    expect(() => {
      assertSlotDateArrived('COMPLETED', slot, 'Asia/Tokyo', lateUtc);
    }).not.toThrow();

    expect(() => {
      assertSlotDateArrived('COMPLETED', slot, 'UTC', lateUtc);
    }).toThrowError();
  });
});

describe('availableActions — the server decides, the client renders', () => {
  const now = new Date('2026-09-14T12:00:00.000Z');
  const past = new Date('2026-09-14T09:00:00.000Z');
  const future = new Date('2026-09-20T09:00:00.000Z');

  it('offers approve, reject and propose-slots on a pending request', () => {
    expect(availableActions('PENDING', future, 'UTC', now)).toEqual([
      'approve',
      'reject',
      'propose-slots',
    ]);
  });

  it('offers only reschedule and cancel on a future booking', () => {
    expect(availableActions('CONFIRMED', future, 'UTC', now)).toEqual(['reschedule', 'cancel']);
  });

  it('adds complete and no-show once the slot date has arrived', () => {
    expect(availableActions('CONFIRMED', past, 'UTC', now)).toEqual([
      'complete',
      'no-show',
      'reschedule',
      'cancel',
    ]);
  });

  it('offers nothing on a terminal appointment', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(availableActions(status, past, 'UTC', now)).toEqual([]);
    }
  });

  /**
   * Every offered action must be one the machine would actually permit.
   * A button that renders and a request that 409s is the exact defect
   * `availableActions` exists to prevent, so the two are cross-checked
   * rather than each asserted against prose.
   */
  it('never offers an action the transition table would refuse', () => {
    const target: Readonly<Record<string, AppointmentStatus>> = {
      approve: 'CONFIRMED',
      reject: 'CANCELLED',
      cancel: 'CANCELLED',
      reschedule: 'RESCHEDULED',
      complete: 'COMPLETED',
      'no-show': 'NO_SHOW',
      'propose-slots': 'AWAITING_PATIENT',
    };

    for (const status of ALL) {
      for (const slot of [past, future]) {
        for (const action of availableActions(status, slot, 'UTC', now)) {
          const to = target[action];
          expect(to, `no target status mapped for ${action}`).toBeDefined();
          expect(
            appointmentStatusMachine.can(status, to as AppointmentStatus),
            `${status} offers ${action} but cannot move to ${String(to)}`,
          ).toBe(true);
        }
      }
    }
  });
});
