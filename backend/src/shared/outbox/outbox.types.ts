/**
 * The transactional-outbox contract (RM M2.3, feeds M19/M30).
 *
 * Several modules must cause an effect in another module: confirming an
 * appointment notifies the patient (API §5/§10), a critical lab result
 * raises an alert (API §8.7), a dispensed prescription updates stock
 * (API §7). Calling the other module's service directly would couple
 * them and would roll the effect back with the caller's transaction —
 * or worse, keep it after the caller's transaction fails.
 *
 * So modules publish a message instead. **M19.1 made the write durable**
 * — `domain_events` rows are written inside the caller's transaction, so
 * an event and the fact it announces commit or roll back together. M30.1
 * owns the other half: draining that table into a BullMQ worker.
 *
 * The boundary rule of M2.2 depends on this: it is what a module uses
 * instead of importing its neighbour.
 */

import type { Prisma } from '../../generated/prisma/client';

/** Payloads carry identifiers, never clinical content (MG §11.6). */
export type OutboxPayload = Readonly<Record<string, string | number | boolean | null>>;

export interface OutboxMessage {
  /** Dotted `entity.event`, e.g. `appointment.confirmed`. */
  readonly topic: string;
  readonly payload: OutboxPayload;
  /**
   * Makes redelivery safe. Delivery is at-least-once by design — an
   * exactly-once queue does not exist — so every consumer must be able
   * to recognise a message it already handled.
   */
  readonly dedupeKey?: string;
  readonly correlationId?: string;
}

/**
 * The narrow slice of a Prisma transaction the outbox writes through.
 *
 * Typed as the generated `TransactionClient` rather than a hand-rolled
 * structural interface: a structural stand-in would have to restate
 * Prisma's overloaded `create` signature, and one that drifted would
 * fail at the call site rather than here. `shared/database` already
 * exposes these types to the kernel, so this adds no new dependency.
 */
export type OutboxTransaction = Prisma.TransactionClient;

export interface OutboxPort {
  /**
   * Resolves once the message is *recorded*, not once it is delivered.
   * A caller that awaited delivery would be back to the coupling this
   * exists to remove.
   *
   * Use this only for an effect with no database transaction to join —
   * the row is written in its own transaction, so a caller that rolls
   * back afterwards leaves an event for a fact that never happened.
   * When there is a transaction, use `publishWithin`.
   */
  publish(message: OutboxMessage): Promise<void>;

  /**
   * Records the message **inside the caller's transaction** (RM M19.1).
   *
   * This is the form that makes the outbox an outbox: the event row and
   * the domain rows share a commit, so a rollback takes the event with
   * it and no consumer ever sees an event for work that was undone.
   */
  publishWithin(tx: OutboxTransaction, message: OutboxMessage): Promise<void>;
}

/** DI token — inject the interface, never a concrete class. */
export const OUTBOX = Symbol('OUTBOX');
