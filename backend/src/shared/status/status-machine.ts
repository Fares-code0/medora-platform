import { AppException } from '../../common/errors/app.exception';

/**
 * Status machines — the shared kernel's one piece of real logic (RM M2.3).
 *
 * Four modules move records through a fixed lifecycle: appointments
 * (API §5, ADR-001), prescriptions (API §7, ADR-002), lab orders
 * (API §8) and access requests (API §9.11, ADR-006). Each of them has to
 * answer the same two questions — *may this transition happen* and *what
 * may this record do next* — and each of them must answer 409 with a
 * `detail` when the answer is no (API §0.3).
 *
 * Written once here rather than four times in four modules, because the
 * frontend already derives its action buttons from a transition table
 * (`availableActions()` in the appointments seam). Two independent
 * transition tables for the same entity is how a button that renders
 * becomes a request that 409s.
 *
 * This kernel is deliberately generic: it owns no statuses. The tables
 * live with the modules that own the entity, and arrive with M11, M13,
 * M14 and M20.
 */

/** For each status, the statuses a record may legally move to next. */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export interface StatusMachine<S extends string> {
  /** Entity name, used in the 409 `detail` so the message names the record. */
  readonly entity: string;
  /** Every status in the table, declaration order preserved. */
  readonly statuses: readonly S[];
  /** True when nothing may follow — a completed or cancelled record. */
  isTerminal(status: S): boolean;
  /** The legal next statuses. Drives the frontend's action list. */
  allowedFrom(status: S): readonly S[];
  can(from: S, to: S): boolean;
  /**
   * Throws 409 with a `detail` naming both ends of the illegal move.
   * Services call this before writing, never after.
   */
  assert(from: S, to: S): void;
}

/**
 * A no-op transition (`from === to`) is rejected rather than silently
 * allowed. Re-confirming an already-confirmed appointment is a stale
 * client acting on a view it fetched before someone else moved the
 * record — the same lost-update race that 409 exists to report.
 */
export function defineStatusMachine<S extends string>(
  entity: string,
  table: TransitionTable<S>,
): StatusMachine<S> {
  const statuses = Object.keys(table) as S[];

  const allowedFrom = (status: S): readonly S[] => table[status] ?? [];

  const can = (from: S, to: S): boolean => allowedFrom(from).includes(to);

  return {
    entity,
    statuses,
    isTerminal: (status) => allowedFrom(status).length === 0,
    allowedFrom,
    can,
    assert(from, to) {
      if (can(from, to)) return;

      // The detail is machine-generated from status names only. Statuses
      // are enum values, never free text, so this cannot carry PHI into
      // an error body (MG §11.6).
      const next = allowedFrom(from);
      const detail =
        next.length === 0
          ? `${entity} is ${from} and cannot change status`
          : `${entity} cannot move from ${from} to ${to}; allowed: ${next.join(', ')}`;

      throw AppException.conflict(detail, 'invalid_status_transition');
    },
  };
}
