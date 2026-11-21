import { z } from 'zod';

import { envelopeSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';

/**
 * The HTTP account adapter.
 *
 * ── Five routes, and all five exist ──────────────────────────────────
 *
 * `POST /me/password` is transcribed from
 * `backend/src/modules/auth/controllers/account-password.controller.ts:26`.
 * It is one of the sixteen routes the backend serves today (audit §3.1,
 * §15.1 row `POST /api/v1/me/password`) and is `@Authenticated()`, so the
 * access token `ApiClient` already attaches is all it needs.
 *
 * It lives in its own module rather than in `auth.ts` for the reason the
 * controller itself gives: the *route* belongs to the account surface
 * ("Users & Account" in the contract) while the *rules* belong to auth.
 * `auth.ts` is a transcription of `auth.controller.ts`; a `me/…` path in
 * it would make that file's own header untrue.
 *
 * ── The contract, verbatim ───────────────────────────────────────────
 *
 * Request  `{ currentPassword, newPassword }` — `changePasswordSchema`
 *          in `dto/recovery.schema.ts`. `newPassword` is `strongPassword`;
 *          `currentPassword` is `min(1)` deliberately, so a password that
 *          predates a policy change cannot lock its owner out of the one
 *          endpoint that would let them fix it.
 * Success  **204 No Content.** There is no body to parse and therefore no
 *          response schema here — inventing one would be inventing a
 *          contract.
 * Failure  `401 invalid_credentials` — the current password is wrong.
 *          This is NOT an expired session, and `ApiClient` does not
 *          refresh on it (`isTokenExpiryError`), which is the whole point
 *          of checklist D-02.
 *          `422 weak_password` — with `fieldErrors.newPassword`, both for
 *          a password that fails the policy and for one that equals the
 *          current password (the server compares against the stored hash,
 *          not the string).
 *
 * ── What the server does that the client must not re-implement ───────
 *
 * A successful change revokes every OTHER session and leaves this one
 * signed in (`password-recovery.service.ts`, API §2 business rules). The
 * client neither logs itself out nor tries to prune a session list it
 * does not own — it says what happened and re-reads.
 *
 * ── The three 2FA routes (checklist D-16) ────────────────────────────
 *
 * Transcribed from `two-factor.controller.ts:40,47,57` — API §2.9, and
 * live today. All three are `@Authenticated()` at class level, so the
 * access token is the whole authorization rule; each acts on the
 * caller's own account and takes no identifier.
 *
 * `POST /me/2fa/setup`    Body `{ password }` — the CURRENT password
 *                         (owner decision D2); `401 invalid_credentials`
 *                         when wrong and `429` once the shared sign-in
 *                         guess budget is spent, with nothing issued.
 *                         200 `{ otpauthUrl, secret, recoveryCodes }`.
 *                         The ONLY response that ever carries the
 *                         recovery codes — they are stored encrypted and
 *                         never read back, so losing them means running
 *                         setup again.
 * `POST /me/2fa/enable`   204. Body `{ code }`, exactly six digits
 *                         (`enableTwoFactorSchema`). The flag flips only
 *                         once a code from the authenticator checks out.
 * `POST /me/2fa/disable`  204. Body `{ password }` — the password and
 *                         NOT a code, which the contract fixes and which
 *                         is right: someone holding the phone but not
 *                         the password is exactly who must not be able
 *                         to remove the second factor. Every other
 *                         session ends.
 *
 * **Whether 2FA is on is reported by `GET /me/2fa`** (owner decision R2,
 * `8992a208`, now on `main`), with the remaining recovery-code count.
 * Against an older API that predates R2 it is 404 and this client cannot
 * know, so `TwoFactorSetup` falls back to offering both actions without
 * asserting a state. Re-enrolment
 * (`/me/2fa/reenroll`, Q7 / R4) ships with it; `/me/2fa/setup` now
 * answers 409 for an account that already has a factor.
 *
 * ── `PATCH /me/account` (checklist P-03) ─────────────────────────────
 *
 * Transcribed from `users/controllers/account.controller.ts:54` — API
 * §2.2, live since M8. `@Authenticated()` with no `userId` parameter:
 * the subject is the token, and the controller says in as many words why
 * that is the whole rule — *"a `@Can(...)` would deny patients, who hold
 * zero capabilities (ADR-030 §6) and who have an account settings screen
 * like anyone else."* Patients are the audience, not a side effect.
 *
 * **This is not the route RA-030.2 blocks.** That decision is about the
 * *clinical record* — which of `patients.*` a patient may change, and who
 * wins when a clinician edits the same field. This route writes
 * `users.phone`, the account's own contact detail, which has no clinician
 * on the other side of it. `endpoints/profile.ts` already keeps the two
 * telephone numbers apart; this is the one of them a patient owns.
 *
 * `phone` is the only field sent. The schema also takes `username`, which
 * this client has no concept of and must not invent one for. **`email` is
 * absent from the schema deliberately** and the reason is worth keeping
 * here: changing a sign-in address needs the new one verified and the old
 * one notified, or a borrowed session moves the account to an attacker's
 * inbox and password reset hands them the keys. There is no such flow, so
 * the profile keeps `email` read-only.
 *
 * Request  `{ phone }` — 7–30 characters after trimming.
 * Success  **200** with the updated `AccountView`. It carries neither
 *          `displayName` nor the clinical half, so it cannot rebuild the
 *          profile document on its own — the caller re-reads
 *          `GET /me/profile`, which is this tree's standing rule for a
 *          write (`SecurityScreen`, `ChangePasswordForm`).
 * Failure  `422` with `fieldErrors.phone`.
 */
/** API §2.9. Read exactly, and nothing more, from the setup response. */
const enrolmentSchema = envelopeSchema(
  z.object({
    secret: z.string().min(1),
    otpauthUrl: z.string().min(1),
    recoveryCodes: z.array(z.string().min(1)),
  }),
);

/**
 * `GET /me/2fa` (owner decision R2) — `{ enabled, recoveryCodesRemaining }`,
 * the only place the server states the remaining count. Served on `main`
 * since R2 (`8992a208`); an older API answers 404.
 */
const twoFactorStatusSchema = envelopeSchema(
  z.object({
    enabled: z.boolean(),
    recoveryCodesRemaining: z.number().int().min(0),
  }),
);

/** `POST /me/2fa/reenroll` (owner decision Q7 / R4), step 1 of 2. */
const reenrolmentSchema = envelopeSchema(
  z.object({
    secret: z.string().min(1),
    otpauthUrl: z.string().min(1),
    enrolmentToken: z.string().min(1),
  }),
);

/** `POST /me/2fa/reenroll/confirm`, step 2 of 2: the new codes, once. */
const reenrolmentResultSchema = envelopeSchema(
  z.object({ recoveryCodes: z.array(z.string().min(1)) }),
);

export const accountEndpoints = {
  /**
   * API §2.2. Returns the updated account; the caller re-reads the
   * profile rather than patching its own copy from this response.
   */
  async updateAccount(body: { phone: string }): Promise<void> {
    await apiClient.patch<unknown>('me/account', body);
  },

  /** 204 on success. Throws a normalized `ApiError` otherwise. */
  async changePassword(body: { currentPassword: string; newPassword: string }): Promise<void> {
    await apiClient.post<unknown>('me/password', body);
  },

  /** 200 with the enrolment. The recovery codes are in this response only. */
  async setupTwoFactor(body: { password: string }) {
    const payload = await apiClient.post<unknown>('me/2fa/setup', body);
    return parseResponse('me/2fa/setup', enrolmentSchema, payload).data;
  },

  /** 204 on success. `422` when the code does not check out. */
  async enableTwoFactor(body: { code: string }): Promise<void> {
    await apiClient.post<unknown>('me/2fa/enable', body);
  },

  /** 204 on success. `401 invalid_credentials` when the password is wrong. */
  async disableTwoFactor(body: { password: string }): Promise<void> {
    await apiClient.post<unknown>('me/2fa/disable', body);
  },

  async twoFactorStatus() {
    const payload = await apiClient.get<unknown>('me/2fa');
    return parseResponse('GET /me/2fa', twoFactorStatusSchema, payload).data;
  },

  /**
   * The current password and a code from the CURRENT authenticator. The
   * password spends from the sign-in guess budget; the guess that locks
   * the account revokes this session (429).
   */
  async startTwoFactorReenrollment(body: { password: string; code: string }) {
    const payload = await apiClient.post<unknown>('me/2fa/reenroll', body);
    return parseResponse('POST /me/2fa/reenroll', reenrolmentSchema, payload).data;
  },

  /** A code from the NEW secret. Only now are the factor and the codes replaced. */
  async confirmTwoFactorReenrollment(body: { enrolmentToken: string; code: string }) {
    const payload = await apiClient.post<unknown>('me/2fa/reenroll/confirm', body);
    return parseResponse('POST /me/2fa/reenroll/confirm', reenrolmentResultSchema, payload).data
      .recoveryCodes;
  },
};
