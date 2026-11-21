/**
 * Claiming domain events for fan-out (RM M19.2).
 *
 * ## Why `FOR UPDATE SKIP LOCKED` and not `findMany` + `updateMany`
 *
 * Correctness here must not depend on there being one backend process.
 * Two instances polling the same table with an ordinary `SELECT` would
 * both read the same pending rows and both build the same notifications
 * — a doctor paged twice for one critical result. `SKIP LOCKED` makes
 * the claim itself the mutual exclusion: each row is locked by exactly
 * one transaction, and the other instance walks past it instead of
 * blocking on it.
 *
 * The claim flips `status` to `delivered` **in the same statement** that
 * selects the row, so a crash between select and update cannot leave a
 * row claimed-but-not-marked. The trade is at-most-once for the fan-out
 * of an individual event if the process dies mid-batch, which is why
 * `attempts` and `last_error` exist: M30.1 adds the retry policy that
 * turns this into at-least-once, and the notification writes are
 * idempotent on `dedupe_key` when it does.
 *
 * Raw SQL rather than the query builder because Prisma cannot express
 * `FOR UPDATE SKIP LOCKED` — ADR-023 §4's rule exactly: raw SQL is for
 * what Prisma cannot represent, and nothing else.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

export interface ClaimedEvent {
  readonly id: string;
  readonly topic: string;
  readonly payload: Record<string, unknown>;
  readonly correlationId: string | null;
}

@Injectable()
export class DomainEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claims up to `limit` pending events, oldest first.
   *
   * The CTE is one statement: the inner `SELECT … FOR UPDATE SKIP
   * LOCKED` picks the rows this caller owns, and the `UPDATE` marks them
   * before anyone else can see them as pending.
   */
  async claim(limit: number): Promise<readonly ClaimedEvent[]> {
    return this.prisma.$queryRaw<ClaimedEvent[]>`
      WITH claimed AS (
        SELECT id
        FROM domain_events
        WHERE status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE domain_events AS e
      SET status = 'delivered',
          delivered_at = now(),
          attempts = e.attempts + 1
      FROM claimed
      WHERE e.id = claimed.id
      RETURNING e.id, e.topic, e.payload, e.correlation_id AS "correlationId"
    `;
  }

  /**
   * Records that fan-out failed for an event that was already claimed.
   *
   * The row stays `delivered` rather than returning to `pending`: this
   * milestone has no retry policy, and a row that flipped back would be
   * re-claimed on the next pass and fail identically forever, producing
   * a duplicate notification each time it half-succeeded. M30.1 owns the
   * backoff and the dead-letter queue that make a retry safe; until then
   * the error is recorded where an operator can find it.
   */
  async recordFailure(eventId: string, error: string): Promise<void> {
    await this.prisma.db.domainEvent.update({
      where: { id: eventId },
      data: { status: 'failed', lastError: error.slice(0, 2000) },
    });
  }

  /** Test and operator visibility; the drain itself never reads this. */
  pendingCount(): Promise<number> {
    return this.prisma.db.domainEvent.count({ where: { status: 'pending' } });
  }
}
