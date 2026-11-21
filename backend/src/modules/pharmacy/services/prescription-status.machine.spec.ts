import { describe, expect, it } from 'vitest';

import type { AppException } from '../../../common/errors/app.exception';
import type { PrescriptionStatus } from '../../../generated/prisma/enums';

import {
  assertDiscontinuable,
  prescriptionStatusMachine,
  signedStatusFor,
} from './prescription-status.machine';

/**
 * The ADR-002 lifecycle, exhaustively (RM M13.3).
 *
 * Seven statuses, so 7 × 7 = 49 assertions over a table **transcribed
 * independently of the implementation** — a test that reads its
 * expectations from the thing under test passes just as happily when the
 * thing is wrong. The sweep is driven from
 * `prescriptionStatusMachine.statuses`, so an eighth status cannot
 * quietly go untested.
 */

const ALL: readonly PrescriptionStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'ACTIVE',
  'DISPENSED',
  'COMPLETED',
  'DISCONTINUED',
  'EXPIRED',
];

/** ADR-002 §3's lifecycle table, transcribed by hand from the ADR. */
const LEGAL: Readonly<Record<PrescriptionStatus, readonly PrescriptionStatus[]>> = {
  DRAFT: ['ACTIVE', 'PENDING_APPROVAL', 'DISCONTINUED'],
  PENDING_APPROVAL: ['ACTIVE', 'EXPIRED', 'DISCONTINUED'],
  ACTIVE: ['DISPENSED', 'COMPLETED', 'EXPIRED', 'DISCONTINUED'],
  DISPENSED: ['COMPLETED', 'EXPIRED', 'DISCONTINUED'],
  COMPLETED: [],
  DISCONTINUED: [],
  EXPIRED: [],
};

describe('the transition table', () => {
  it('covers every status in the enum', () => {
    expect([...prescriptionStatusMachine.statuses].sort()).toEqual([...ALL].sort());
  });

  for (const from of ALL) {
    for (const to of ALL) {
      const legal = LEGAL[from].includes(to);

      it(`${legal ? 'allows' : 'refuses'} ${from} → ${to}`, () => {
        expect(prescriptionStatusMachine.can(from, to)).toBe(legal);

        if (legal) {
          expect(() => {
            prescriptionStatusMachine.assert(from, to);
          }).not.toThrow();

          return;
        }

        let thrown: AppException | undefined;
        try {
          prescriptionStatusMachine.assert(from, to);
        } catch (error) {
          thrown = error as AppException;
        }

        expect(thrown).toBeDefined();
        expect(thrown?.getStatus()).toBe(409);
      });
    }
  }
});

describe('terminality', () => {
  it('treats completed, discontinued and expired as terminal', () => {
    for (const status of ['COMPLETED', 'DISCONTINUED', 'EXPIRED'] as const) {
      expect(prescriptionStatusMachine.isTerminal(status)).toBe(true);
      expect(prescriptionStatusMachine.allowedFrom(status)).toEqual([]);
    }
  });

  it('treats the four live statuses as non-terminal', () => {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'DISPENSED'] as const) {
      expect(prescriptionStatusMachine.isTerminal(status)).toBe(false);
    }
  });

  it('never allows a dispensed prescription back to active', () => {
    // ADR-002 §2, in as many words: "cannot return to `active`".
    expect(prescriptionStatusMachine.can('DISPENSED', 'ACTIVE')).toBe(false);
  });

  it('never allows a signed prescription back to draft', () => {
    // The signature CHECK makes the row unrepresentable anyway; the
    // machine refuses it first, with a message a client can read.
    for (const status of ['ACTIVE', 'PENDING_APPROVAL', 'DISPENSED'] as const) {
      expect(prescriptionStatusMachine.can(status, 'DRAFT')).toBe(false);
    }
  });
});

describe('the 409 detail', () => {
  it('speaks wire values, never Prisma members', () => {
    let thrown: AppException | undefined;
    try {
      prescriptionStatusMachine.assert('DISPENSED', 'ACTIVE');
    } catch (error) {
      thrown = error as AppException;
    }

    expect(thrown?.code).toBe('invalid_status_transition');
    expect(thrown?.detail).toContain('dispensed');
    expect(thrown?.detail).toContain('active');
    expect(thrown?.detail).not.toContain('DISPENSED');
    expect(thrown?.detail).toContain('completed, expired, discontinued');
  });

  it('says so plainly when the prescription is terminal', () => {
    let thrown: AppException | undefined;
    try {
      prescriptionStatusMachine.assert('COMPLETED', 'ACTIVE');
    } catch (error) {
      thrown = error as AppException;
    }

    expect(thrown?.detail).toBe('Prescription is completed and cannot change status');
  });
});

describe('where /sign lands', () => {
  it('sends a controlled medication to pending-approval', () => {
    expect(signedStatusFor(true)).toBe('PENDING_APPROVAL');
  });

  it('sends everything else straight to active', () => {
    expect(signedStatusFor(false)).toBe('ACTIVE');
  });
});

describe('discontinuation', () => {
  it('accepts every signed live status', () => {
    for (const status of ['PENDING_APPROVAL', 'ACTIVE', 'DISPENSED'] as const) {
      expect(() => {
        assertDiscontinuable(status);
      }).not.toThrow();
    }
  });

  it('refuses a draft, and says why (D-13.1)', () => {
    // ADR-002 §3 lists `draft → discontinued` and the M5.10 trigger
    // permits it, but the M5.8 CHECK
    // `prescriptions_signed_at_matches_status` makes the resulting row
    // unrepresentable: a withdrawn draft carries no signature. Refused
    // here with a named 409 rather than left to surface as a constraint
    // violation the caller reads as a 500. The table itself still allows
    // the transition — the contradiction is recorded, not papered over.
    expect(prescriptionStatusMachine.can('DRAFT', 'DISCONTINUED')).toBe(true);

    let thrown: AppException | undefined;
    try {
      assertDiscontinuable('DRAFT');
    } catch (error) {
      thrown = error as AppException;
    }

    expect(thrown?.getStatus()).toBe(409);
    expect(thrown?.code).toBe('draft_not_discontinuable');
    expect(thrown?.detail).toContain('D-13.1');
  });

  it('refuses a prescription that has already ended', () => {
    for (const status of ['COMPLETED', 'DISCONTINUED', 'EXPIRED'] as const) {
      expect(() => {
        assertDiscontinuable(status);
      }).toThrowError();
    }
  });
});
