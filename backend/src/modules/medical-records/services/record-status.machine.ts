/**
 * The record lifecycle (RM M12.3 — API §6.5).
 *
 * `draft → active → completed → archived`, guarded. The contract writes
 * it as an arrow chain, which reads as strictly forward, and this table
 * takes it literally:
 *
 *  - **No backward edge.** A completed record does not become a draft
 *    again. A clinical document that could be un-finalised is one whose
 *    "completed" means nothing, and the correction path is an amendment
 *    with its own version row (M12.6), not a rewind.
 *  - **No skipping.** `draft → completed` would leave the record
 *    never having been active, which is the state the action queue and
 *    the summary cards both count.
 *  - **`archived` is terminal.** Archiving is the end of the document's
 *    working life; retention (ADR-007) governs what happens after, and
 *    that is a job's decision rather than a clinician's.
 *
 * Written against the shared kernel so the 409 carries the `detail`
 * API §0.3 requires, and worded in the wire vocabulary rather than in
 * Prisma members.
 */

import { AppException } from '../../../common/errors/app.exception';
import type { RecordStatus } from '../../../generated/prisma/enums';
import { defineStatusMachine, type TransitionTable } from '../../../shared/status';
import { recordStatusToWire } from '../dto/record-enums';

const TABLE: TransitionTable<RecordStatus> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['COMPLETED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
};

const machine = defineStatusMachine<RecordStatus>('Medical record', TABLE);

export const recordStatusMachine = {
  statuses: machine.statuses,
  isTerminal: (status: RecordStatus): boolean => machine.isTerminal(status),
  allowedFrom: (status: RecordStatus): readonly RecordStatus[] => machine.allowedFrom(status),
  can: (from: RecordStatus, to: RecordStatus): boolean => machine.can(from, to),

  assert(from: RecordStatus, to: RecordStatus): void {
    if (machine.can(from, to)) return;

    const next = machine.allowedFrom(from);
    const detail =
      next.length === 0
        ? `Medical record is ${recordStatusToWire(from)} and cannot change status`
        : `Medical record cannot move from ${recordStatusToWire(from)} to ` +
          `${recordStatusToWire(to)}; allowed: ${next.map(recordStatusToWire).join(', ')}`;

    throw AppException.conflict(detail, 'invalid_status_transition');
  },
} as const;

/**
 * The statuses a clinician may still edit.
 *
 * A `completed` or `archived` record is finalised. Editing one silently
 * would make the status a label rather than a state, and the correction
 * path — an amendment with a version row — is a different action a
 * reviewer can see. 409 rather than 403: the caller is permitted, the
 * document is not in a state that accepts the write.
 */
const EDITABLE: readonly RecordStatus[] = ['DRAFT', 'ACTIVE'];

export function assertEditable(status: RecordStatus): void {
  if (EDITABLE.includes(status)) return;

  throw AppException.conflict(
    `A ${recordStatusToWire(status)} record cannot be edited`,
    'record_not_editable',
  );
}
