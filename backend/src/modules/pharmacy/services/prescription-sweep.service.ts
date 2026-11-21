/**
 * The expiry sweep and the refill-due pass (RM M13.5).
 *
 * ## A service, not a queue — and that is the repository's own pattern
 *
 * RM **M30.2** owns the "scheduled jobs registry: **prescription
 * expiry**, retention purges, scheduled reports …", and M30.1 owns the
 * BullMQ queue registry, retries and dead-lettering. So this milestone
 * owns the *sweep*; M30 owns *when it runs*. Building a queue here would
 * put the same infrastructure in two milestones and leave M30 removing
 * it — the same split `shared/outbox` already records ("published
 * messages are logged and discarded … the consumers are M19's channels
 * and M30's workers, and neither exists").
 *
 * BullMQ is deliberately **not** added as a dependency for the same
 * reason.
 *
 * ## The clock is a parameter
 *
 * `sweep(now)` takes its clock rather than calling `new Date()`, which
 * is what makes RM M13.5's "job test with clock control" a test of the
 * job rather than of the system time. Every date comparison in here
 * flows from that one argument.
 *
 * ## Expiry follows ADR-002 §3 exactly, and is not softened for refills
 *
 * The ADR's row is unqualified: `active | dispensed | pending-approval`
 * → `expired`, "expiry sweep past `end_date`". A prescription with
 * refills remaining is **not** exempted, and this sweep does not invent
 * an exemption — a course that has run its length has run its length,
 * and a repeat is a renewal (§7.8) or a dispense against a live script,
 * not an expiry that quietly does not happen.
 *
 * `draft` is not swept. A draft has not been prescribed (ADR-002 §1), so
 * there is no course to expire; an abandoned one simply stays a draft.
 */

import { Injectable, Logger } from '@nestjs/common';

import { PrescriptionRepository } from '../repositories/prescription.repository';

export interface SweepResult {
  /** References moved to `expired`. */
  readonly expired: readonly string[];
  /** References whose `refill_status` became `due`. */
  readonly refillDue: readonly string[];
  /**
   * Null when no refill-due window is configured, which is the state
   * today — see PD-13.5. Distinct from `0`, which would mean "due on the
   * day the course ends".
   */
  readonly refillDueWindowDays: number | null;
}

export interface SweepOptions {
  /**
   * How many days before `end_date` a prescription with refills
   * remaining becomes `due`.
   *
   * **There is no default, and that is the point.** No source in this
   * repository states this number: API §7 lists the `due` value in the
   * refill vocabulary, the frontend's mock assigns it *at random by
   * weight* (`mock-data.ts:109-113`), and UX names no window. A constant
   * invented here would be, in ADR-033 Q4's words about the same class
   * of decision, "not a policy — it is a policy nobody can change
   * without a deploy".
   *
   * So the mechanism is built and the number is the caller's. Omitted,
   * no prescription becomes `due` and the sweep says so in its result.
   * See PD-13.5.
   */
  readonly refillDueWindowDays?: number | undefined;
}

@Injectable()
export class PrescriptionSweepService {
  private readonly logger = new Logger('PrescriptionSweep');

  constructor(private readonly prescriptions: PrescriptionRepository) {}

  /**
   * One pass. Idempotent: running it twice over the same clock moves
   * nothing the second time, because every row it would touch has left
   * the statuses it selects on.
   *
   * Expiry runs **first**. A prescription past its end date is expired,
   * not due for a refill, and doing it the other way round would flag a
   * finished course as needing one.
   */
  async sweep(now: Date, options: SweepOptions = {}): Promise<SweepResult> {
    const expired = await this.prescriptions.expirePast(now);

    if (expired.length > 0) {
      this.logger.log({
        sweep: { expired: expired.length, at: now.toISOString() },
        msg: 'Prescriptions expired past their end date',
      });
    }

    const window = options.refillDueWindowDays;

    if (window === undefined) {
      // No policy, no computation. Reporting the absence rather than
      // silently doing nothing is what stops "the sweep ran and found
      // none" being mistaken for "no window is configured".
      return { expired, refillDue: [], refillDueWindowDays: null };
    }

    const refillDue = await this.prescriptions.markRefillsDue(now, window);

    if (refillDue.length > 0) {
      this.logger.log({
        sweep: { refillDue: refillDue.length, windowDays: window, at: now.toISOString() },
        msg: 'Prescriptions marked refill-due',
      });
    }

    return { expired, refillDue, refillDueWindowDays: window };
  }
}
