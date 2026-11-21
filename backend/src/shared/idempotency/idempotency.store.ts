import { Injectable } from '@nestjs/common';

import { isUniqueViolation, PrismaService } from '../database';
import type { Prisma } from '../../generated/prisma/client';

/** ADR-014: "TTL is 24 h … a mechanical retry window, not a product policy". */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

export interface IdempotencyRequest {
  readonly userId: string;
  readonly key: string;
  /** `METHOD /path`, ids included. */
  readonly endpoint: string;
  /** SHA-256 hex of the canonical body. */
  readonly fingerprint: string;
}

/**
 * What the store found for a key.
 *
 * - `claimed` — the key is new (or its previous use expired); the caller
 *   executes the request and must later `complete` or `release` it.
 * - `replay` — a completed request with the same endpoint and body; the
 *   caller returns `body` without executing.
 * - `in_progress` — the first request is still running.
 * - `mismatch` — the key was used for a different endpoint or body.
 */
export type IdempotencyClaim =
  | { readonly kind: 'claimed'; readonly id: string }
  | { readonly kind: 'replay'; readonly body: unknown }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'mismatch' };

/**
 * The durable half of ADR-014 (`idempotency_records`).
 *
 * The claim is an `INSERT` guarded by `UNIQUE (user_id, key)`, so two
 * concurrent first requests cannot both execute: one inserts, the other
 * hits the constraint and reads the winner's row. That is the whole
 * concurrency story, and it is the database's rather than this process's
 * — it holds across replicas.
 */
@Injectable()
export class IdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  async claim(request: IdempotencyRequest, now: Date = new Date()): Promise<IdempotencyClaim> {
    // Two passes at most: the second runs only after an expired row was
    // removed, and a third would mean another request claimed the key in
    // between — which the second pass reports as it finds it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const created = await this.prisma.db.idempotencyRecord.create({
          data: {
            userId: request.userId,
            key: request.key,
            endpoint: request.endpoint,
            fingerprint: request.fingerprint,
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
          select: { id: true },
        });

        return { kind: 'claimed', id: created.id };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }

      const existing = await this.prisma.db.idempotencyRecord.findUnique({
        where: { userId_key: { userId: request.userId, key: request.key } },
      });

      // Released between the insert and the read: try the insert again.
      if (existing === null) continue;

      if (existing.expiresAt <= now) {
        // Conditional on the row read, so a concurrent request that has
        // just re-claimed the key is not deleted from under it.
        await this.prisma.db.idempotencyRecord.deleteMany({
          where: { id: existing.id, expiresAt: { lte: now } },
        });
        continue;
      }

      if (existing.endpoint !== request.endpoint || existing.fingerprint !== request.fingerprint) {
        return { kind: 'mismatch' };
      }

      if (existing.status !== 'completed') return { kind: 'in_progress' };

      return { kind: 'replay', body: existing.responseBody };
    }

    return { kind: 'in_progress' };
  }

  /** Stores the result a replay will return. */
  async complete(id: string, body: unknown, now: Date = new Date()): Promise<void> {
    await this.prisma.db.idempotencyRecord.updateMany({
      where: { id, status: 'in_progress' },
      data: {
        status: 'completed',
        completedAt: now,
        // `undefined` (a 204) is stored as JSON null; a replay of a 204
        // returns no body either way.
        responseBody: (body ?? null) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Gives the key back after a failed request, so the client's retry
   * executes rather than being told the first attempt is still running.
   * Only an in-progress row is removed: a completed one is the answer.
   */
  async release(id: string): Promise<void> {
    await this.prisma.db.idempotencyRecord.deleteMany({ where: { id, status: 'in_progress' } });
  }

  /** The sweep: every row past its window. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.db.idempotencyRecord.deleteMany({
      where: { expiresAt: { lte: now } },
    });

    return result.count;
  }
}
