/**
 * Marking results reviewed (RM M14.5 — API §8.7).
 *
 * > "Critical results: individual review only (`bulk:false`); bulk
 * > allowed only when all flags normal; write failure must surface (no
 * > optimistic success)."
 *
 * The rules live in `lab-review.ts`, which is the only producer of the
 * value this service writes from. What this file owns is the *posture*
 * around them, and there are three decisions in it worth naming.
 *
 * ## A bulk request is all-or-nothing, and a partial one is a 422
 *
 * If any named order may not go through the bulk path, **none** does.
 * The alternative — review the eligible ones, report the rest — returns
 * 2xx for a request that did not do what was asked, and the safe reading
 * of a 2xx is "all of it worked". A doctor who asked to clear eight
 * results and had six cleared has no way to see which two are still
 * waiting. So the refusal names every refused reference and writes
 * nothing.
 *
 * ## "Write failure must surface" is a property of the transaction
 *
 * The bulk write is one transaction (`markManyReviewed`). A failure
 * anywhere in it rolls the whole thing back and propagates, reaching the
 * client as a 5xx with `ref` — never a 200 with a shorter list than the
 * request. This service adds nothing to make that true; it is careful
 * **not** to catch, because a `catch` that returned a partial success
 * here is exactly the optimistic success the verify step forbids.
 *
 * ## D-14.1 — the acknowledgment has nowhere on the row to live
 *
 * `lab_orders` carries `reviewed_at` and `reviewed_by` and nothing else.
 * DB §E3 has no acknowledgment columns — unlike DB §F4, which gives a
 * prescription's safety warnings `acknowledged_by`,
 * `acknowledged_reason` and `acknowledged_at`, tied together by a CHECK.
 * `LabTimelineKind` has no `reviewed` member either, so there is not
 * even a timeline row to put the note on.
 *
 * So the acknowledgment — which critical values were ticked, and the
 * note saying what was done about them — is dispatched to
 * `AUDIT_DISPATCHER` (module 14), which is where the reason for a
 * clinical act belongs. The rule itself is fully enforced: a critical
 * result cannot be reviewed without both, and `assessReviewability`
 * refuses before anything is written.
 *
 * **But the evidence is not durable yet, and that is worth stating
 * plainly.** The dispatcher's current implementation is
 * `LoggingAuditDispatcher`, the M2 stub that writes a log line; the
 * `audit_events` table is not wired behind the token until M28, and that
 * file says so itself ("Not a substitute for M28. Logs are not queryable
 * by entity, are not retained per DB §7, and are lost on a crash"). So
 * today a critical acknowledgment is *required*, *recorded* at the call
 * site, and *not retrievable*. M28 makes it retrievable without any call
 * site changing; a column on `lab_orders` would make it retrievable
 * beside the review it belongs to.
 *
 * **Needs an owner decision**, and it is a schema change either way:
 * either `lab_orders` gains the three columns DB §F4 already has for
 * prescriptions, or DB §E7 gains a `reviewed` timeline kind and the note
 * goes in its `detail`. Inventing either here would be a migration on a
 * clinical table written to satisfy a milestone rather than a decision.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import type { LabOrderDetailView, LabOrderView } from '../dto/lab-order.dto';
import type { ReviewLabOrderInput, ReviewLabOrdersInput } from '../dto/lab-order.schema';
import { LabOrderRepository, type DetailRow } from '../repositories/lab-order.repository';

import {
  assessReviewability,
  assertReviewable,
  partitionForBulkReview,
  REVIEW_BLOCKED_META,
  type ReviewBlockedReason,
  type ReviewCandidate,
} from './lab-review';
import { toLabOrderDetailView, toLabOrderView } from './lab-order-projection';
import { LabOrderService } from './lab-order.service';

export interface LabReviewResult {
  readonly reviewed: readonly LabOrderView[];
}

@Injectable()
export class LabReviewService {
  constructor(
    private readonly context: LabOrderService,
    private readonly orders: LabOrderRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  /** API §8.7 — one order, reviewed individually. */
  async reviewOne(
    user: AuthenticatedUser,
    publicId: string,
    input: ReviewLabOrderInput,
  ): Promise<LabOrderDetailView> {
    const current = await this.context.require(user, publicId);

    const outcome = assessReviewability({
      order: candidateOf(current),
      acknowledgedResultIds: input.acknowledgedResultIds ?? [],
      note: input.note ?? '',
      bulk: false,
    });

    if (outcome.reviewable === null) {
      throw AppException.conflict(
        REVIEW_BLOCKED_META[outcome.blockedBy],
        blockedCode(outcome.blockedBy),
        'Cannot mark reviewed',
      );
    }

    // The runtime half of the guarantee. A forged value — a cast, a
    // hand-built object — does not survive this, so no path reaches the
    // write without having gone through the check above.
    assertReviewable(outcome.reviewable);

    const reviewedAt = new Date();
    const row = await this.orders.markReviewed({
      orderId: current.id,
      reviewerId: user.id,
      reviewedAt,
    });

    // Lost the compare-and-set: a colleague reviewed this between the
    // read and the write. 409 rather than overwriting their attribution,
    // which is what `lab_orders_reviewed_by_iff_reviewed` makes
    // meaningful in the first place.
    if (row === null) {
      throw AppException.conflict(
        'This result was reviewed by someone else while this request was in flight',
        'conflict',
      );
    }

    await this.audit.record({
      action: 'lab_order.review',
      actor: { userId: user.id, role: user.role },
      entityType: 'lab_order',
      entityId: row.publicId,
      metadata: {
        bulk: false,
        hadCritical: outcome.reviewable.hadCritical,
        // See D-14.1: this is the only durable home the acknowledgment
        // has. The ids are the *result* rows ticked, and the note is the
        // clinician's account of what was done about them — the thing a
        // later review actually reads.
        // Joined because `AuditMetadata` is scalar-only by design.
        acknowledgedResultIds:
          outcome.reviewable.acknowledgment.acknowledgedResultIds.join(', '),
        acknowledgmentNote: outcome.reviewable.acknowledgment.note,
      },
    });

    if (outcome.reviewable.hadCritical) {
      await this.activity.record({
        userId: user.id,
        kind: 'profile',
        summary: 'Reviewed a critical lab result',
        // The reference, not the analyte or the value: the feed names
        // what changed, never the clinical value it changed to.
        detail: row.publicId,
      });
    }

    return toLabOrderDetailView(row, new Date());
  }

  /**
   * API §8.7 — the bulk path.
   *
   * Reachable only by orders whose every flag is `normal`. The partition
   * is computed before anything is written, and a single refusal fails
   * the request — see the file header.
   */
  async reviewMany(
    user: AuthenticatedUser,
    input: ReviewLabOrdersInput,
  ): Promise<LabReviewResult> {
    const doctor = await this.context.requireDoctor(user);

    // Care-scoped by the repository's own clause, so an id outside the
    // caller's scope simply does not come back — and is then reported as
    // unknown below, which discloses nothing about whether it exists.
    const rows = await this.orders.findManyForDoctor(doctor, input.ids);
    const found = new Map(rows.map((row) => [row.publicId, row]));

    const missing = input.ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw AppException.notFound(
        `No lab order for ${missing.join(', ')}`,
      );
    }

    const { eligible, refused } = partitionForBulkReview(rows.map(candidateOf));

    if (refused.length > 0) {
      // 422 and not 409: the verify step names 422, and the request is
      // being refused because of what it *contains* rather than because
      // of a state race. `fieldErrors` is keyed by reference so a client
      // can mark the offending rows individually — which is precisely
      // the "review it on its own" the message asks for.
      throw AppException.validation(
        Object.fromEntries(
          refused.map((refusal) => [refusal.reference, [REVIEW_BLOCKED_META[refusal.reason]]]),
        ),
        'Some of these results cannot be cleared in a bulk action',
        'bulk_review_refused',
      );
    }

    for (const order of eligible) assertReviewable(order);

    const reviewedAt = new Date();
    // One transaction, and deliberately not wrapped in a try/catch: a
    // failure must reach the client as a 5xx rather than as a shorter
    // list. See "write failure must surface" in the file header.
    const moved = await this.orders.markManyReviewed({
      orderIds: eligible.map((order) => ({
        reference: order.reference,
        id: found.get(order.reference)?.id ?? '',
      })),
      reviewerId: user.id,
      reviewedAt,
    });

    if (moved.length !== eligible.length) {
      // Someone reviewed one of these between the read and the write.
      // The transaction committed what it could, so the honest answer is
      // a 409 naming the difference rather than a 200 implying the whole
      // batch was this caller's work.
      throw AppException.conflict(
        `${String(eligible.length - moved.length)} of these results were reviewed by someone ` +
          'else while this request was in flight. Reload and try the remainder.',
        'conflict',
      );
    }

    await this.audit.record({
      action: 'lab_order.review_bulk',
      actor: { userId: user.id, role: user.role },
      entityType: 'lab_order',
      // A bulk action has no single subject, so the entity is the batch
      // and the references are in the metadata where they can be
      // searched.
      entityId: `${String(moved.length)} orders`,
      metadata: { bulk: true, references: moved.join(', '), count: moved.length, hadCritical: false },
    });

    const reviewed = await this.orders.findManyForDoctor(doctor, moved);
    const now = new Date();

    return { reviewed: reviewed.map((row) => toLabOrderView(row, now)) };
  }
}

/** The order reduced to what the review rules ask about. */
function candidateOf(row: DetailRow): ReviewCandidate {
  return {
    reference: row.publicId,
    reviewedAt: row.reviewedAt,
    results: row.results.map((result) => ({ id: result.id, flag: result.flag })),
  };
}

/**
 * A distinct code per refusal, so a client branches on the reason rather
 * than on the message (ADR-012 — the message may be reworded, the code
 * may not).
 *
 * `unacknowledged-critical` and `missing-note` share
 * `acknowledgment_required` deliberately: they are the two halves of one
 * condition — a tick with no reason is not an acknowledgment — and the
 * pharmacy raises the same code for the same reason at API §7.7. The
 * `detail` is what tells the two apart for a human.
 *
 * `Record<ReviewBlockedReason, …>` rather than a switch, so a sixth
 * refusal reason stops the build here instead of defaulting to a generic
 * `conflict` a client cannot act on.
 */
const BLOCKED_CODE: Record<ReviewBlockedReason, string> = {
  'no-results': 'nothing_to_review',
  'already-reviewed': 'already_reviewed',
  'unacknowledged-critical': 'acknowledgment_required',
  'missing-note': 'acknowledgment_required',
  'bulk-not-normal': 'bulk_review_refused',
};

function blockedCode(reason: ReviewBlockedReason): string {
  return BLOCKED_CODE[reason];
}
