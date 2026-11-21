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
export const Idempotent = (): MethodDecorator & ClassDecorator => SetMetadata(IDEMPOTENT, true);
