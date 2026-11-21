/**
 * The lab pipeline (RM M14.2 — API §8.5).
 *
 * API §8's header writes it as `ordered→collected→processing→completed`
 * `(+cancelled)`, and this table takes the arrow chain literally.
 *
 *  - **No backward edge.** A specimen that reached the analyser does not
 *    become uncollected. Correcting a mis-stepped order is a cancel and
 *    a re-order, which leaves both facts in the timeline, rather than a
 *    rewind that leaves neither.
 *  - **No skipping.** `ordered → processing` would mean a specimen in
 *    the analyser that no chain of custody accounts for, and §8.3's
 *    specimen document — collector, time, site, condition — is captured
 *    at exactly the step that would be skipped.
 *  - **`cancelled` is reachable from every live step and from none of
 *    the dead ones.** §8.5's body offers `cancelled` unconditionally, and
 *    a specimen can be abandoned at any point before release: the tube
 *    is dropped, the patient leaves, the analyser rejects it.
 *  - **`completed` is terminal.** A released result is a clinical fact
 *    that other records now cite. Amending one is an addendum
 *    (`lab_attachments.kind = 'addendum'`), not a status that moves back.
 *
 * Written against the shared kernel (RM M2.3) so the 409 carries the
 * `detail` API §0.3 requires, and worded in the wire vocabulary rather
 * than in Prisma members.
 *
 * ## What the table deliberately does NOT encode
 *
 * Nothing here knows about specimen condition. Whether a hemolyzed
 * sample may be processed is the specimen's answer
 * (`specimen-condition.ts`), not the machine's, and the two failures
 * carry different codes so a client can tell "this order is in the wrong
 * state" from "this specimen is unusable". A machine that also held the
 * condition rule would report a clotted sample as an invalid transition,
 * which tells the lab nothing about what to do next — redraw.
 */

import { AppException } from '../../../common/errors/app.exception';
import type { LabStatus } from '../../../generated/prisma/enums';
import { defineStatusMachine, type TransitionTable } from '../../../shared/status';
import { labStatusToWire } from '../dto/labs-enums';

/**
 * `Record<LabStatus, …>` through `TransitionTable` makes exhaustiveness
 * the compiler's problem: a sixth status stops the build here rather
 * than silently having no outbound transitions at runtime.
 */
const TABLE: TransitionTable<LabStatus> = {
  ORDERED: ['COLLECTED', 'CANCELLED'],
  COLLECTED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const machine = defineStatusMachine<LabStatus>('Lab order', TABLE);

export const labStatusMachine = {
  statuses: machine.statuses,
  isTerminal: (status: LabStatus): boolean => machine.isTerminal(status),
  allowedFrom: (status: LabStatus): readonly LabStatus[] => machine.allowedFrom(status),
  can: (from: LabStatus, to: LabStatus): boolean => machine.can(from, to),

  /** Throws 409 `invalid_status_transition`, worded in wire values. */
  assert(from: LabStatus, to: LabStatus): void {
    if (machine.can(from, to)) return;

    const next = machine.allowedFrom(from);
    const detail =
      next.length === 0
        ? `Lab order is ${labStatusToWire(from)} and cannot change status`
        : `Lab order cannot move from ${labStatusToWire(from)} to ${labStatusToWire(to)}; ` +
          `allowed: ${next.map(labStatusToWire).join(', ')}`;

    throw AppException.conflict(detail, 'invalid_status_transition');
  },
} as const;

/**
 * The statuses that still accept a result (RM M14.4 — API §8.6).
 *
 * `processing` only. Entering a value against an order the lab has not
 * started is a result for a specimen nobody has run, and entering one
 * against a `completed` order would change a released result without an
 * addendum. 409 rather than 403: the caller is permitted, the order is
 * not in a state that accepts the write.
 *
 * The `lab_orders_interpretation_requires_completion` CHECK (M5.8) backs
 * the other end of this: an interpretation may only exist on a completed
 * order, so results and their reading cannot both be provisional.
 */
export function assertResultable(status: LabStatus): void {
  if (status === 'PROCESSING') return;

  throw AppException.conflict(
    status === 'COMPLETED'
      ? 'This order is completed; its results are released. Amend it with an addendum rather ' +
          'than by overwriting a value another record may already cite.'
      : `Results can only be entered while an order is processing; this one is ` +
          `${labStatusToWire(status)}.`,
    'order_not_resultable',
  );
}
