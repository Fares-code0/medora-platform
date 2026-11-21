/**
 * The ADR-002 lifecycle (RM M13.3/M13.4 — API §7).
 *
 * ## One table, two enforcement points
 *
 * This machine decides which requests succeed and returns the 409 with
 * the `detail` API §0.3 requires; the `prescriptions_enforce_transition`
 * trigger from M5.10 decides which rows may exist. The trigger is a
 * backstop for a migration or a psql session — a backstop may be looser
 * than the rule it backs, and the reverse would be the defect.
 *
 * ## `draft` is the load-bearing state
 *
 * ADR-002 §1: a draft has not been prescribed. It generates no
 * notification, produces no timeline `prescribed` event, and does not
 * appear in the patient's medication list. It is also what makes API
 * §7.7's fail-closed rule *expressible*: a prescription whose safety
 * check could not run **stays in draft**, which is a state a client can
 * filter on, rather than a null timestamp that is invisible to
 * `GET /prescriptions?status=`.
 *
 * ## What the table deliberately does NOT encode
 *
 * Nothing here knows about safety. Whether a signature is permitted is
 * the screen's answer, not the machine's, and the two failures carry
 * different codes so a client can tell "this prescription is in the
 * wrong state" from "this prescription is unsafe". A machine that also
 * held the safety rule would make an allergy conflict report as an
 * invalid transition.
 */

import { AppException } from '../../../common/errors/app.exception';
import type { PrescriptionStatus } from '../../../generated/prisma/enums';
import { defineStatusMachine, type TransitionTable } from '../../../shared/status';
import { prescriptionStatusToWire } from '../dto/pharmacy-enums';

/**
 * ADR-002 §3, verbatim.
 *
 * `Record<PrescriptionStatus, …>` through `TransitionTable` makes
 * exhaustiveness the compiler's problem: an eighth status stops the
 * build here rather than silently having no outbound transitions at
 * runtime.
 */
const TABLE: TransitionTable<PrescriptionStatus> = {
  // `/sign` goes to `active`, or to `pending-approval` when the
  // medication is controlled. `/cancel` on an unsent draft resolves to
  // `discontinued` (ADR-002 §4 — two routes, one status).
  DRAFT: ['ACTIVE', 'PENDING_APPROVAL', 'DISCONTINUED'],
  PENDING_APPROVAL: ['ACTIVE', 'EXPIRED', 'DISCONTINUED'],
  ACTIVE: ['DISPENSED', 'COMPLETED', 'EXPIRED', 'DISCONTINUED'],
  // Terminal-adjacent: ADR-002 §2 — a dispensed prescription may still
  // expire or be discontinued, but "cannot return to `active`".
  DISPENSED: ['COMPLETED', 'EXPIRED', 'DISCONTINUED'],
  // Terminal. A completed course is a clinical fact; a discontinued one
  // is a decision someone is accountable for; an expired one is the
  // calendar's verdict. None is edited into something else — a
  // correction is a new prescription, which is what `/renew` is for.
  COMPLETED: [],
  DISCONTINUED: [],
  EXPIRED: [],
};

const machine = defineStatusMachine<PrescriptionStatus>('Prescription', TABLE);

export const prescriptionStatusMachine = {
  statuses: machine.statuses,
  isTerminal: (status: PrescriptionStatus): boolean => machine.isTerminal(status),
  allowedFrom: (status: PrescriptionStatus): readonly PrescriptionStatus[] =>
    machine.allowedFrom(status),
  can: (from: PrescriptionStatus, to: PrescriptionStatus): boolean => machine.can(from, to),

  /** Throws 409 `invalid_status_transition`, worded in wire values. */
  assert(from: PrescriptionStatus, to: PrescriptionStatus): void {
    if (machine.can(from, to)) return;

    const next = machine.allowedFrom(from);
    const detail =
      next.length === 0
        ? `Prescription is ${prescriptionStatusToWire(from)} and cannot change status`
        : `Prescription cannot move from ${prescriptionStatusToWire(from)} to ` +
          `${prescriptionStatusToWire(to)}; allowed: ` +
          next.map(prescriptionStatusToWire).join(', ');

    throw AppException.conflict(detail, 'invalid_status_transition');
  },
} as const;

/**
 * Where `/sign` lands (ADR-002 §3).
 *
 * A controlled medication needs a second decision, so it lands in
 * `pending-approval`; everything else goes straight to `active`. The
 * "or the policy requires approval" half of ADR-002's row is **not**
 * implemented: no policy field exists anywhere to express it, and
 * inventing one would mean deciding which medications need
 * countersigning — see PD-13.3 in the roadmap.
 *
 * `is_high_risk` deliberately does **not** route here. High-alert means
 * "a mistake with this drug is unusually harmful" (warfarin, insulin),
 * which is a reason to warn the prescriber, not a reason to require a
 * second signature. Conflating the two would put every anticoagulant in
 * an approval queue no source asks for.
 */
export function signedStatusFor(isControlled: boolean): PrescriptionStatus {
  return isControlled ? 'PENDING_APPROVAL' : 'ACTIVE';
}

/**
 * The statuses `/discontinue` and `/cancel` may act on (ADR-002 §3).
 *
 * Everything non-terminal. 409 rather than 403 when it is not: the
 * caller is permitted, the prescription is not in a state that accepts
 * the write.
 *
 * ## D-13.1 — `draft → discontinued` is legal and unrepresentable
 *
 * ADR-002 §3's lifecycle table lists `draft` among the origins of
 * `discontinued`, and the M5.10 trigger permits it. But the M5.8 CHECK
 * `prescriptions_signed_at_matches_status` is
 * `(status = 'draft') = (signed_at IS NULL)` — so any row that leaves
 * `draft` must carry a signature, and a cancelled draft was signed by
 * nobody. The two artefacts are both derived from ADR-002 and they
 * contradict each other on exactly this transition.
 *
 * **Not resolved here, because neither resolution is this milestone's to
 * invent.** Stamping `signed_at` to satisfy the constraint would record
 * that a clinician signed a prescription they explicitly withdrew —
 * a false entry in a clinical record. Relaxing the constraint is a
 * schema decision, and the constraint is deliberate: ADR-002 §1 makes
 * "every status past draft is reached through `/sign`" the rule that
 * keeps an unsigned prescription out of the approval queue.
 *
 * So the path is refused **here**, with a 409 that names the reason,
 * rather than left to surface as a constraint violation the caller reads
 * as a 500. An abandoned draft simply stays a draft; nothing dispenses
 * it, the expiry sweep ignores it (M13.5 sweeps `active`), and it is
 * invisible to the patient's medication list (ADR-002 §1).
 */
export function assertDiscontinuable(status: PrescriptionStatus): void {
  if (status === 'DRAFT') {
    throw AppException.conflict(
      'A draft cannot be discontinued: `prescriptions_signed_at_matches_status` requires a ' +
        'signature on every status past `draft`, and a withdrawn draft was signed by nobody. ' +
        'See D-13.1 — ADR-002 §3 and the M5.8 CHECK disagree on this one transition. ' +
        'An abandoned draft may simply be left; it dispenses nothing.',
      'draft_not_discontinuable',
    );
  }

  prescriptionStatusMachine.assert(status, 'DISCONTINUED');
}
