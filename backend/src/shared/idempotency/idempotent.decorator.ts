import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT = 'medora:idempotent';

/**
 * Marks a state-changing POST as accepting `Idempotency-Key` (ADR-014).
 *
 * Opt-in per route rather than on every POST, as ADR-014 decided against
 * "implement idempotency for every POST": naturally idempotent writes and
 * read-shaped POSTs gain nothing, and the stored responses cost real
 * storage. The routes carrying it are MG §8.4's — prescription send,
 * appointment create, message send — and the other side-effecting sends
 * beside them.
 */
export interface IdempotentOptions {
  /**
   * The route refuses a request without `Idempotency-Key` (422), instead
   * of taking ADR-014 §3's unkeyed default path. For writes whose double
   * execution is a harm the client cannot undo — a patient booking
   * (contract §6).
   */
  readonly required?: boolean;
}

/** What `@Idempotent()` stores: `true` (optional key) or the options. */
export type IdempotentMetadata = true | IdempotentOptions;

export const Idempotent = (options?: IdempotentOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(IDEMPOTENT, options === undefined ? true : options);
