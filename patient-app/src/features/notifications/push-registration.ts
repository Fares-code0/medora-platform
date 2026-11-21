/**
 * Push notifications — **not implemented, deliberately**.
 *
 * ── Why there is no code here ────────────────────────────────────────
 * Push needs three things that do not exist:
 *
 * 1. **A registration endpoint.** `POST /me/devices` is roadmap M41.2 and
 *    unbuilt (audit BE-12). `notification_deliveries` has a `PUSH`
 *    channel in the schema and nothing behind it.
 * 2. **A provider.** No FCM/APNs credentials, no Expo push project, no
 *    server-side sender.
 * 3. **`AD-1`.** `Notification.userId -> User`, so there is no patient to
 *    deliver to.
 *
 * The wrong move would be to request the OS notification permission now,
 * store an Expo token locally, and call it "prepared". That trains the
 * patient to grant a permission the app cannot use, and a permission
 * granted for nothing is a permission that gets revoked before it is
 * needed.
 *
 * ── What this file is instead ────────────────────────────────────────
 * The recorded dependency and the shape of the eventual call, so that
 * when BE-12 lands the work is "implement this interface", not "design
 * push". `expo-notifications` is deliberately NOT a dependency of this
 * package yet — adding it would be an install for a capability with no
 * server.
 *
 * Checklist rows O-03, O-04, O-05 and O-07 stay open and blocked.
 */

export interface PushRegistration {
  readonly deviceToken: string;
  readonly platform: 'ios' | 'android';
}

export interface PushService {
  /** Asks for permission, obtains a token, and registers it server-side. */
  register(): Promise<PushRegistration | null>;
  /** Called on logout: the device must stop receiving this patient's alerts. */
  unregister(): Promise<void>;
}

export const PUSH_BLOCKERS = {
  registrationEndpoint: 'BE-12 — POST /me/devices does not exist (roadmap M41.2)',
  provider: 'No push provider is configured for this project',
  identity: 'AD-1 — Notification.userId references User; a patient has no user row',
} as const;
