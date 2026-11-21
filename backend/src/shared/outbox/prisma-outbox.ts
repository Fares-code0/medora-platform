import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database';

import type { OutboxMessage, OutboxPort, OutboxTransaction } from './outbox.types';

/**
 * The durable writer behind `OUTBOX` (RM M19.1).
 *
 * Replaces `LoggingOutbox`, the M2 stub that logged and discarded.
 * ADR-019 §2 said that stub was acceptable *because nothing consumed it
 * yet* and blocking eighteen modules on M30 would be the larger harm; it
 * also recorded, in `Cost carried forward`, that the replacement owes a
 * writer which enlists in the caller's transaction. This is that writer.
 *
 * ## The two methods are not interchangeable
 *
 * `publishWithin` is the real one. It writes through the transaction
 * handle the caller is already inside, so the event row and the domain
 * rows share a single commit — the property the outbox pattern exists
 * for, and the one M19.1's verify step tests by rolling back and
 * asserting no orphan event survives.
 *
 * `publish` opens its own transaction. It is correct only where there is
 * no enclosing one to join, and its doc comment on the port says so. It
 * is kept because several M6–M16 call sites publish *after* their write
 * has already committed, and rewriting all of them is not M19.1's scope;
 * each is a place where a crash between the two loses the event, which
 * is a smaller and more visible failure than the alternative.
 *
 * ## Recording never fails the caller's request
 *
 * Except that it must, when it is inside the transaction: a
 * `publishWithin` that swallowed its error would commit the domain rows
 * without the event and silently reintroduce the bug this table removes.
 * So only `publish` catches — the same reasoning `PrismaActivityRecorder`
 * applies, for the same kind of after-the-fact call site.
 *
 * ## A repeated `dedupeKey` is not an error
 *
 * At-least-once delivery means a publisher may legitimately retry, and
 * the unique index exists to collapse the retry rather than to reject
 * it. `createMany` with `skipDuplicates` says that in one statement — an
 * exists-then-insert would race another publisher between the two
 * queries and raise the very violation it was checking for.
 */
@Injectable()
export class PrismaOutbox implements OutboxPort {
  private readonly logger = new Logger('Outbox');

  constructor(private readonly prisma: PrismaService) {}

  async publish(message: OutboxMessage): Promise<void> {
    try {
      await this.prisma.db.domainEvent.createMany({
        data: [PrismaOutbox.row(message)],
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.error(
        { err: error, topic: message.topic, dedupeKey: message.dedupeKey },
        'Could not record a domain event',
      );
    }
  }

  async publishWithin(tx: OutboxTransaction, message: OutboxMessage): Promise<void> {
    await tx.domainEvent.createMany({
      data: [PrismaOutbox.row(message)],
      skipDuplicates: true,
    });
  }

  /**
   * One row builder for both entry points, so they cannot drift in what
   * they store. The statement itself is written twice because the two
   * clients are different types — `prisma.db` carries the soft-delete
   * extension and a transaction handle does not — and a shared parameter
   * would have to widen to the intersection of two generated generics.
   */
  private static row(message: OutboxMessage) {
    return {
      topic: message.topic,
      payload: message.payload,
      ...(message.dedupeKey === undefined ? {} : { dedupeKey: message.dedupeKey }),
      ...(message.correlationId === undefined ? {} : { correlationId: message.correlationId }),
    };
  }
}
