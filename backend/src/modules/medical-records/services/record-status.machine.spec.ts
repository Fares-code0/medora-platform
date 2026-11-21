import { describe, expect, it } from 'vitest';

import type { AppException } from '../../../common/errors/app.exception';
import type { RecordStatus } from '../../../generated/prisma/enums';

import { assertEditable, recordStatusMachine } from './record-status.machine';

/**
 * The record lifecycle, exhaustively (RM M12.3 — API §6.5).
 *
 * Four states is sixteen ordered pairs, and the sweep asserts every one
 * against a table transcribed independently of the implementation. The
 * point of doing it this way rather than in prose is that a fifth status
 * cannot quietly go untested.
 */

const ALL: readonly RecordStatus[] = ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'];

/** API §6.5's arrow chain, read literally: forward, one step at a time. */
const LEGAL: Readonly<Record<RecordStatus, readonly RecordStatus[]>> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['COMPLETED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
};

describe('the record lifecycle', () => {
  it('covers every status in the enum', () => {
    expect([...recordStatusMachine.statuses].sort()).toEqual([...ALL].sort());
  });

  for (const from of ALL) {
    for (const to of ALL) {
      const legal = LEGAL[from].includes(to);

      it(`${legal ? 'allows' : 'refuses'} ${from} → ${to}`, () => {
        expect(recordStatusMachine.can(from, to)).toBe(legal);
      });
    }
  }

  it('treats archived as terminal', () => {
    expect(recordStatusMachine.isTerminal('ARCHIVED')).toBe(true);
  });

  it('refuses every backward edge', () => {
    // A clinical document that could be un-finalised is one whose
    // "completed" means nothing. Corrections are amendments with their
    // own version row, not a rewind.
    expect(recordStatusMachine.can('ACTIVE', 'DRAFT')).toBe(false);
    expect(recordStatusMachine.can('COMPLETED', 'ACTIVE')).toBe(false);
    expect(recordStatusMachine.can('ARCHIVED', 'COMPLETED')).toBe(false);
  });

  it('refuses skipping a step', () => {
    expect(recordStatusMachine.can('DRAFT', 'COMPLETED')).toBe(false);
    expect(recordStatusMachine.can('DRAFT', 'ARCHIVED')).toBe(false);
    expect(recordStatusMachine.can('ACTIVE', 'ARCHIVED')).toBe(false);
  });

  it('names the wire vocabulary and the allowed next step in the detail', () => {
    let thrown: AppException | null = null;
    try {
      recordStatusMachine.assert('DRAFT', 'COMPLETED');
    } catch (error) {
      thrown = error as AppException;
    }

    expect(thrown?.code).toBe('invalid_status_transition');
    expect(thrown?.detail).toContain('draft');
    expect(thrown?.detail).toContain('allowed: active');
    expect(thrown?.detail).not.toContain('DRAFT');
  });

  it('says a terminal record cannot change rather than listing nothing', () => {
    let thrown: AppException | null = null;
    try {
      recordStatusMachine.assert('ARCHIVED', 'ACTIVE');
    } catch (error) {
      thrown = error as AppException;
    }

    expect(thrown?.detail).toContain('cannot change status');
  });
});

describe('editability', () => {
  it('allows edits while the record is being worked', () => {
    for (const status of ['DRAFT', 'ACTIVE'] as const) {
      expect(() => {
        assertEditable(status);
      }).not.toThrow();
    }
  });

  it('refuses edits on a finalised record, with its own code', () => {
    for (const status of ['COMPLETED', 'ARCHIVED'] as const) {
      let thrown: AppException | null = null;
      try {
        assertEditable(status);
      } catch (error) {
        thrown = error as AppException;
      }

      // 409 rather than 403: the caller is permitted, the document is
      // not in a state that accepts the write. A distinct code so the
      // client can say which.
      expect(thrown?.code).toBe('record_not_editable');
    }
  });
});
