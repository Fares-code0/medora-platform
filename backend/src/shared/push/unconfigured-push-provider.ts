import type { PushOutcome, PushProvider } from './push.types';

/**
 * The binding while no push provider is configured.
 *
 * `configured: false` is the whole of its behaviour: the delivery worker
 * reads it and records `skipped / no-provider` without calling `send`.
 * `send` refuses rather than pretending, in case anything ever does call
 * it — a push that reported `sent` with no provider behind it would be a
 * delivery receipt for a message nobody sent.
 */
export class UnconfiguredPushProvider implements PushProvider {
  readonly configured = false;

  send(): Promise<readonly PushOutcome[]> {
    return Promise.reject(new Error('No push provider is configured'));
  }
}
