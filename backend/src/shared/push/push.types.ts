/**
 * The push provider port (RM M41.2, mobile contract P5.8).
 *
 * A port, like mail and object storage: the provider is an external
 * service, and which one — Firebase Cloud Messaging, Apple Push
 * Notification service, Expo's push service — is a decision with
 * credentials attached that no document has made. Until one is bound,
 * `UnconfiguredPushProvider` says so and the delivery worker records
 * `skipped / no-provider`, which is what it recorded before this port
 * existed.
 */

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushTarget {
  /** The provider's opaque token for one device. */
  readonly token: string;
  /** `ios`, `android`, … — some providers route by platform. */
  readonly platform: string;
}

/**
 * What a push carries. Identifiers only, never clinical content: it is
 * built from the notification's title and body, which M19.2 composes
 * from the PHI-free outbox payload — the same rule the email channel
 * follows. A lock screen is the least private surface the platform has.
 */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
}

export type PushOutcome =
  | { readonly token: string; readonly outcome: 'sent'; readonly providerRef?: string }
  /** The provider says this token will never work again; it is cleared. */
  | { readonly token: string; readonly outcome: 'invalid-token' }
  | { readonly token: string; readonly outcome: 'failed'; readonly error: string };

export interface PushProvider {
  /** `false` until a real provider is bound. The worker checks it first. */
  readonly configured: boolean;
  /** One outcome per target, in any order. Rejects only on a provider-wide failure. */
  send(targets: readonly PushTarget[], message: PushMessage): Promise<readonly PushOutcome[]>;
}
