import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception';

import { defineStatusMachine } from './status-machine';

/**
 * The fixture is the appointment lifecycle of ADR-001, trimmed to the
 * transitions the assertions need. It lives here rather than in the
 * appointments module because that module has no statuses until M11 —
 * the kernel is what is under test, not the table.
 */
type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled';

const appointments = defineStatusMachine<AppointmentStatus>('appointment', {
  scheduled: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
});

describe('defineStatusMachine', () => {
  it('permits declared transitions and refuses undeclared ones', () => {
    expect(appointments.can('scheduled', 'confirmed')).toBe(true);
    expect(appointments.can('scheduled', 'completed')).toBe(false);
  });

  it('treats a status with no successors as terminal', () => {
    expect(appointments.isTerminal('completed')).toBe(true);
    expect(appointments.isTerminal('cancelled')).toBe(true);
    expect(appointments.isTerminal('scheduled')).toBe(false);
  });

  it('exposes the next statuses in declaration order', () => {
    // The frontend renders its action buttons from this list, so the
    // order is part of the contract, not an implementation detail.
    expect(appointments.allowedFrom('confirmed')).toEqual(['completed', 'cancelled']);
    expect(appointments.allowedFrom('completed')).toEqual([]);
  });

  it('rejects a transition to the same status', () => {
    // A stale client re-confirming what someone else already moved is
    // the lost-update race, not a harmless no-op.
    expect(appointments.can('confirmed', 'confirmed')).toBe(false);
  });

  it('assert() throws 409 with a detail naming the legal moves', () => {
    let thrown: unknown;
    try {
      appointments.assert('scheduled', 'completed');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppException);
    const exception = thrown as AppException;
    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(exception.code).toBe('invalid_status_transition');
    // API §0.3 makes `detail` mandatory on 409; an empty one is a 409
    // the user cannot act on.
    expect(exception.detail).toBe(
      'appointment cannot move from scheduled to completed; allowed: confirmed, cancelled',
    );
  });

  it('assert() reports a terminal record as terminal rather than listing nothing', () => {
    // "allowed: " with an empty list reads as a bug in the API, not as
    // an answer, so a terminal record gets its own wording.
    let thrown: unknown;
    try {
      appointments.assert('cancelled', 'confirmed');
    } catch (error) {
      thrown = error;
    }

    expect((thrown as AppException).detail).toBe(
      'appointment is cancelled and cannot change status',
    );
  });

  it('assert() is silent on a legal transition', () => {
    expect(() => {
      appointments.assert('confirmed', 'completed');
    }).not.toThrow();
  });
});
