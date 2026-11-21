import { z } from 'zod';

import { envelopeSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';

/**
 * The HTTP auth adapter.
 *
 * ── Every path in this file exists in the backend today ──────────────
 *
 * These ten routes are every route `auth.controller.ts` exposes, and each
 * is transcribed from it:
 *
 *   POST /auth/login                  :89
 *   POST /auth/otp/verify             :118
 *   POST /auth/otp/resend             :145
 *   POST /auth/refresh                :162   (body form, X-Client-Type: mobile)
 *   POST /auth/forgot-password        :196
 *   POST /auth/reset-password         :207
 *   POST /auth/verify-email           :218
 *   POST /auth/verification/resend    :235
 *   POST /auth/logout                 :254
 *   POST /auth/register               :65    — SEE BELOW
 *
 * `POST /auth/register` is **live** as of ADR-035. ADR-030 decided AD-1
 * (a patient CAN register) and widened the backend `role` enum;
 * ADR-035 §4 turned that enum into a discriminated union whose patient
 * branch is exactly the account fields — no `licenseNumber`, no
 * professional block, nothing clinical. This client now sends it.
 *
 * The gap that kept `register` throwing was never the backend: the form
 * and schema existed, but neither carried `role`, so the request would
 * have been malformed. Adding the one literal closes it.
 *
 * What a registered patient account gets is deliberately small: ADR-030
 * §4 creates an account and links it to no clinical record, so it can log
 * in and read an empty profile and nothing else until the claim flow is
 * decided (RA-030.1, still open). Registration is not record-claiming.
 *
 * `GET /auth/session` (API §1.11) is served (`auth.controller.ts`), but
 * this client does not call it: session restore goes through
 * `/auth/refresh`, which returns the same user fields, and nothing here
 * needs a second read (checklist D-13).
 *
 * The rest of the live surface (audit §3.1) is `me/password` and `me/2fa`,
 * which are account routes rather than auth-controller ones and belong in
 * their own module: `endpoints/account.ts` holds the first of them.
 *
 * ── Response shapes ──────────────────────────────────────────────────
 * The schemas below describe only what this client reads. They are
 * `.passthrough()`-free but non-exhaustive by construction: Zod ignores
 * unknown keys, so a backend that adds a field does not break this
 * client, and a backend that REMOVES one fails loudly at the seam rather
 * than as `undefined` three components deep.
 */

const identitySchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  // What the backend sends (`SessionUserPayload` in `login.service.ts`:
  // id, name, email, role, permissions). The split fields below are kept
  // as fallbacks for older fixtures.
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  emailVerified: z.boolean().optional(),
});

const tokensSchema = z.object({
  accessToken: z.string().min(1),
  // Present because this client sends `X-Client-Type: mobile`. A web
  // client gets a Set-Cookie here instead and no body field.
  refreshToken: z.string().min(1),
});

const sessionSchema = envelopeSchema(tokensSchema.extend({ user: identitySchema }));

/** A login that resolves to a step-up rather than a session. */
const otpChallengeSchema = envelopeSchema(z.object({ otpToken: z.string().min(1) }));

/** Either shape may come back from `POST /auth/login`. */
const loginSchema = z.union([sessionSchema, otpChallengeSchema]);

/**
 * `POST /auth/register` 201 (ADR-035 §4).
 *
 * `nextStep` is a literal rather than a bare string: it is the value the
 * caller branches on to route to the verify-email screen, and a backend
 * that started answering something else should fail loudly at the seam
 * rather than silently route nowhere.
 */
const registerResultSchema = z.object({
  nextStep: z.literal('verify-email'),
  email: z.string().min(1),
});

export type LoginResponse = z.infer<typeof loginSchema>;
export type SessionResponse = z.infer<typeof sessionSchema>;
export type RegisterResponse = z.infer<typeof registerResultSchema>;

export const authEndpoints = {
  async login(body: { email: string; password: string; rememberMe: boolean }) {
    const raw = await apiClient.post<unknown>('auth/login', body);
    return parseResponse('POST /auth/login', loginSchema, raw);
  },

  async verifyOtp(body: { otpToken: string; code: string }) {
    const raw = await apiClient.post<unknown>('auth/otp/verify', body);
    return parseResponse('POST /auth/otp/verify', sessionSchema, raw);
  },

  async resendOtp(body: { otpToken: string }) {
    await apiClient.post<unknown>('auth/otp/resend', body);
  },

  /**
   * Owner decision R1 — `POST /auth/otp/recovery` completes the same
   * pending step-up with one single-use recovery code instead of the six
   * digits (`auth.controller.ts`, served only by an API built from the
   * `backend` branch, `8992a208`). Same challenge, same attempt budget,
   * same success payload as `otp/verify` — and so the same token-in-body
   * session for this client (`X-Client-Type: mobile`). A wrong code is
   * `401 otp_invalid`; an API without the route answers 404.
   */
  async redeemRecoveryCode(body: { otpToken: string; recoveryCode: string }) {
    const raw = await apiClient.post<unknown>('auth/otp/recovery', body);
    return parseResponse('POST /auth/otp/recovery', sessionSchema, raw);
  },

  /**
   * The mobile refresh path. The token travels in the body because
   * `X-Client-Type: mobile` (set unconditionally by `ApiClient`) makes
   * the backend answer in kind.
   */
  async refresh(body: { refreshToken: string }) {
    const raw = await apiClient.post<unknown>('auth/refresh', body);
    return parseResponse('POST /auth/refresh', sessionSchema, raw);
  },

  async logout() {
    await apiClient.post<unknown>('auth/logout');
  },

  /** Always 202, whether or not the address exists (anti-enumeration). */
  async forgotPassword(body: { email: string }) {
    await apiClient.post<unknown>('auth/forgot-password', body);
  },

  async resetPassword(body: { token: string; password: string }) {
    await apiClient.post<unknown>('auth/reset-password', body);
  },

  async verifyEmail(body: { token: string }) {
    await apiClient.post<unknown>('auth/verify-email', body);
  },

  async resendVerification(body: { email: string }) {
    await apiClient.post<unknown>('auth/verification/resend', body);
  },

  /**
   * `POST /auth/register` with `role: 'patient'` (ADR-030 §4, ADR-035 §4).
   *
   * The role is a **constant, not a parameter**. This client registers
   * patients and nothing else, and a caller-supplied role would be a way
   * for a compromised or modified app to ask the server for a clinician
   * account. The server would refuse — `role` is validated against a
   * union that has no privileged member, and an administrator cannot be
   * self-registered at all — but the client should not be asking in the
   * first place.
   *
   * `confirmPassword` is stripped by the form before it reaches here; the
   * server holds one password and has nothing to compare a copy against.
   *
   * The 201 body is `{ nextStep: 'verify-email', email }` and carries no
   * session: the account exists but cannot sign in until the address is
   * verified.
   */
  async register(body: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
    acceptTerms: true;
    acceptPrivacy: true;
  }) {
    const response = await apiClient.post<unknown>('auth/register', {
      ...body,
      role: 'patient',
    });

    return parseResponse('auth/register', envelopeSchema(registerResultSchema), response);
  },
};
