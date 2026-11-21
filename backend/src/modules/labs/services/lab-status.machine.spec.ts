import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppException } from '../../../common/errors/app.exception';
import type { LabStatus } from '../../../generated/prisma/enums';

import { assertResultable, labStatusMachine } from './lab-status.machine';
import {
  assertProcessable,
  BLOCKING_CONDITIONS,
  isRunnable,
} from './specimen-condition';

/**
 * The transition matrix (RM M14.2's verify step) and the specimen gate
 * (RM M14.3's).
 *
 * The matrix is asserted **exhaustively** — every ordered pair of the
 * five statuses, twenty-five cells — rather than by testing the four
 * arrows that are supposed to work. A table tested only on its allowed
 * edges passes just as happily when a backward edge is added by mistake,
 * and a backward edge here means a released result becoming unreleased.
 */

const STATUSES: readonly LabStatus[] = [
  'ORDERED',
  'COLLECTED',
  'PROCESSING',
  'COMPLETED',
  'CANCELLED',
];

/** API §8's `ordered→collected→processing→completed` (+`cancelled`). */
const ALLOWED: ReadonlySet<string> = new Set([
  'ORDERED>COLLECTED',
  'ORDERED>CANCELLED',
  'COLLECTED>PROCESSING',
  'COLLECTED>CANCELLED',
  'PROCESSING>COMPLETED',
  'PROCESSING>CANCELLED',
]);

describe('RM M14.2 verify — the transition matrix', () => {
  it('permits exactly the six moves API §8 declares, and no others', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(
          labStatusMachine.can(from, to),
          `${from} → ${to}`,
        ).toBe(ALLOWED.has(`${from}>${to}`));
      }
    }
  });

  it('has no backward edge anywhere in the table', () => {
    // Stated separately from the matrix above because it is the property
    // that matters rather than an incidental consequence: a specimen
    // that reached the analyser does not become uncollected, and a
    // released result does not become provisional.
    const order = ['ORDERED', 'COLLECTED', 'PROCESSING', 'COMPLETED'] as const;

    for (const [index, from] of order.entries()) {
      for (const to of order.slice(0, index)) {
        expect(labStatusMachine.can(from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it('refuses a move to the same status', () => {
    // A stale client re-collecting what someone else already moved is
    // the lost-update race, not a harmless no-op.
    for (const status of STATUSES) {
      expect(labStatusMachine.can(status, status)).toBe(false);
    }
  });

  it('makes completed and cancelled terminal and nothing else', () => {
    expect(labStatusMachine.isTerminal('COMPLETED')).toBe(true);
    expect(labStatusMachine.isTerminal('CANCELLED')).toBe(true);
    expect(labStatusMachine.isTerminal('ORDERED')).toBe(false);
    expect(labStatusMachine.isTerminal('COLLECTED')).toBe(false);
    expect(labStatusMachine.isTerminal('PROCESSING')).toBe(false);
  });

  it('allows cancellation from every live step', () => {
    // A tube is dropped, the patient leaves, the analyser rejects the
    // sample — abandonment can happen at any point before release.
    for (const status of ['ORDERED', 'COLLECTED', 'PROCESSING'] as const) {
      expect(labStatusMachine.can(status, 'CANCELLED')).toBe(true);
    }
  });

  it('exposes the next statuses in declaration order', () => {
    // The order is part of the contract, not an implementation detail: a
    // client renders its action buttons from this list, and `collected`
    // before `cancelled` is "the next step, then the way out".
    expect(labStatusMachine.allowedFrom('ORDERED')).toEqual(['COLLECTED', 'CANCELLED']);
    expect(labStatusMachine.allowedFrom('PROCESSING')).toEqual(['COMPLETED', 'CANCELLED']);
    expect(labStatusMachine.allowedFrom('COMPLETED')).toEqual([]);
  });

  it('knows all five statuses', () => {
    expect([...labStatusMachine.statuses].sort()).toEqual([...STATUSES].sort());
  });

  it('assert() returns silently for a legal move', () => {
    // The path the service takes on every successful transition. Testing
    // only the refusals would leave the one branch that lets a request
    // through unexercised.
    for (const key of ALLOWED) {
      const [from, to] = key.split('>') as [LabStatus, LabStatus];
      expect(() => {
        labStatusMachine.assert(from, to);
      }, key).not.toThrow();
    }
  });

  it('assert() throws 409 naming the legal moves', () => {
    let thrown: unknown;
    try {
      labStatusMachine.assert('ORDERED', 'COMPLETED');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppException);
    const exception = thrown as AppException;
    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(exception.code).toBe('invalid_status_transition');
    // API §0.3 makes `detail` mandatory on 409; one the caller cannot
    // act on is a 409 that says nothing.
    expect(exception.detail).toBe(
      'Lab order cannot move from ordered to completed; allowed: collected, cancelled',
    );
  });

  it('assert() reports a terminal order as terminal rather than listing nothing', () => {
    let thrown: unknown;
    try {
      labStatusMachine.assert('COMPLETED', 'PROCESSING');
    } catch (error) {
      thrown = error;
    }

    expect((thrown as AppException).detail).toBe(
      'Lab order is completed and cannot change status',
    );
  });

  it('words the refusal in wire values, never in Prisma members', () => {
    try {
      labStatusMachine.assert('COLLECTED', 'COMPLETED');
    } catch (error) {
      expect((error as AppException).detail).not.toMatch(/[A-Z]{2,}/);
    }
  });
});

describe('assertResultable', () => {
  it('accepts an order that is processing', () => {
    expect(() => {
      assertResultable('PROCESSING');
    }).not.toThrow();
  });

  it('refuses a result on an order the lab has not started', () => {
    for (const status of ['ORDERED', 'COLLECTED'] as const) {
      let thrown: unknown;
      try {
        assertResultable(status);
      } catch (error) {
        thrown = error;
      }

      expect((thrown as AppException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((thrown as AppException).code).toBe('order_not_resultable');
    }
  });

  it('refuses a result on a released order, and says to amend instead', () => {
    let thrown: unknown;
    try {
      assertResultable('COMPLETED');
    } catch (error) {
      thrown = error;
    }

    // Overwriting a released value another record may already cite is
    // the thing an addendum exists for.
    expect((thrown as AppException).detail).toMatch(/addendum/i);
  });
});

describe('RM M14.3 verify — the blocked-condition gate', () => {
  it('names exactly the three conditions the milestone names', () => {
    expect([...BLOCKING_CONDITIONS].sort()).toEqual(
      ['CLOTTED', 'HEMOLYZED', 'INSUFFICIENT_VOLUME'].sort(),
    );
  });

  it('runs an acceptable specimen and nothing else', () => {
    expect(isRunnable('ACCEPTABLE')).toBe(true);
    for (const condition of BLOCKING_CONDITIONS) {
      expect(isRunnable(condition), condition).toBe(false);
    }
  });

  it('lets an acceptable specimen through', () => {
    expect(() => {
      assertProcessable('ACCEPTABLE');
    }).not.toThrow();
  });

  it('refuses each blocking condition with 409 specimen_unusable', () => {
    for (const condition of BLOCKING_CONDITIONS) {
      let thrown: unknown;
      try {
        assertProcessable(condition);
      } catch (error) {
        thrown = error;
      }

      expect(thrown, condition).toBeInstanceOf(AppException);
      expect((thrown as AppException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((thrown as AppException).code).toBe('specimen_unusable');
      // The refusal has to tell a lab what to do next, which is redraw.
      expect((thrown as AppException).detail).toMatch(/recollect/i);
    }
  });

  it('says why the number would be wrong, not merely that it refused', () => {
    try {
      assertProcessable('HEMOLYZED');
    } catch (error) {
      // The clinical reason is the point: a hemolyzed potassium reads
      // high for a patient whose potassium is fine.
      expect((error as AppException).detail).toMatch(/potassium/i);
    }
  });

  it('refuses a missing specimen with its own code', () => {
    // "No specimen" and "bad specimen" are different problems with
    // different remedies, so they are not one error.
    let thrown: unknown;
    try {
      assertProcessable(null);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as AppException).code).toBe('specimen_missing');
  });
});
