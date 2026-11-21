import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * Lets a route accept a validly signed access token whose session has
 * already ended (PRE-01).
 *
 * The access-token guard refuses a token whose session is revoked or
 * expired, or whose account is no longer `ACTIVE`. That is the policy
 * (I4, O-13) and it applies to every authenticated route — with one
 * exception, which is the only route that carries this marker:
 * `POST /auth/logout`.
 *
 * Logout's contract (API §1.6) is "session revoked, cookie cleared,
 * 204". A client whose session was revoked elsewhere — sign out
 * everywhere, a password reset, an administrator's suspension — still
 * holds a refresh cookie, and logout is how it is told to drop it.
 * Answering that client 401 would leave the cookie in place and turn an
 * idempotent sign-out into an error. Letting the request through grants
 * nothing: the handler revokes a session that is already revoked (a
 * no-op) and clears a cookie that no longer refreshes.
 *
 * What is waived is **liveness only**. The signature check is not
 * relaxed — a token this service did not mint is still a 401 — and nor is
 * identity: the token's `sid` must still name a session row that belongs
 * to its `sub`, or the request is a 401 (`SessionService.belongsTo`).
 *
 * The guard reads this marker from the **handler only**, so it cannot be
 * applied to a controller. `test/session-validation.e2e-spec.ts` asserts
 * that `POST /auth/logout` is the only handler that carries it. Do not add
 * it to any route that reads or changes data.
 */
export const ALLOW_ENDED_SESSION_KEY = 'auth:allow-ended-session';

export const AllowEndedSession = (): CustomDecorator<string> =>
  SetMetadata(ALLOW_ENDED_SESSION_KEY, true);
