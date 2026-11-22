/**
 * Push notifications — **not implemented, deliberately**.
 *
 * ── What stands in the way (re-checked 2026-11-20) ───────────────────
 * The list used to name three blockers. Two have moved, and one that was
 * never on it is the one that now decides the order of work.
 *
 * 1. **A registration endpoint — exists now, with a question attached.**
 *    `POST /me/devices` (backend M41.2, migration
 *    `20261030140000_trusted_device_push_token`) takes an optional
 *    `pushToken`, stores it and never returns it; `DELETE
 *    /me/devices/{id}` clears it. But the row it writes is a **trusted
 *    device** (API §2.6) — a security record a patient sees under
 *    Security. Whether asking for notifications should also create one is
 *    a backend/owner question, not something this client should decide by
 *    calling the route.
 * 2. **A provider — still missing, and this is the blocker.** The
 *    backend binds only `UnconfiguredPushProvider`, so every push delivery
 *    is recorded as `skipped / no-provider`. On this side there is no
 *    `expo-notifications` (refused by (4) below), no FCM/APNs
 *    credentials, and no real EAS `projectId` (`app.json` holds a zero
 *    UUID), so there is no token to send even though the endpoint in (1)
 *    would accept one.
 * 3. ~~`AD-1` — a patient has no user row.~~ Resolved by ADR-030: a
 *    patient is an account, and `GET /notifications` already serves this
 *    app.
 * 4. **The OS permission — an owner decision.** Which runtime permissions
 *    this app may request is `docs/STORE_PRIVACY.md` §6 (W-02), and
 *    `src/test/store-privacy.test.ts` fails the build on
 *    `expo-notifications` by name until it is answered.
 *
 * The wrong move would be to request the OS notification permission now,
 * store an Expo token locally, and call it "prepared". That trains the
 * patient to grant a permission the app cannot use — nothing would ever
 * arrive while (2) stands — and a permission granted for nothing is a
 * permission that gets revoked before it is needed.
 *
 * ── What this file is instead ────────────────────────────────────────
 * The recorded dependency and the shape of the eventual call, so that
 * when the provider and the permission decision land the work is
 * "implement this interface", not "design push".
 *
 * Checklist rows O-03, O-04 (its push half), O-05 and O-07 stay open and
 * blocked.
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
  registrationEndpoint:
    'POST /me/devices accepts a pushToken (M41.2), but registers a trusted device; whether push should is undecided',
  provider: 'No push provider: the backend binds only UnconfiguredPushProvider',
  osPermission:
    'W-02 §6 — the owner decides which runtime permissions the app may request; expo-notifications is refused until then',
} as const;
