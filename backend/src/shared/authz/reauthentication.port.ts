/**
 * Reusable re-authentication (multi-hospital fix-list item 5).
 *
 * Break-Glass / Exceptional Access and Emergency Override require the
 * requester to re-prove their password at the moment of the request (§2.9).
 * The check itself — the password hash, the shared lockout budget, the
 * session revocation on lockout, the `auth.reauthenticate*` audit rows —
 * already lives in the auth module's `ReauthenticationService`, behind
 * `POST /me/password/verify`. A second implementation would drift from it,
 * and the module-boundary rule forbids another domain module from importing
 * the auth module directly.
 *
 * So the shared kernel owns a port, and the auth module binds its service to
 * it at start-up. Consumers inject `ReauthenticationPort` and call `verify`.
 *
 * **Fail closed.** If nothing has been bound (a test harness that mounts a
 * module without the auth module, or a wiring mistake) `verify` throws rather
 * than treating the password as proven.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';

export interface ReauthenticationVerifier {
  /**
   * Resolves when `password` is the principal's current password; otherwise
   * rejects (401 `invalid_credentials`, or 429 when the guess budget is spent).
   */
  verify(principal: AuthenticatedUser, password: string): Promise<void>;
}

@Injectable()
export class ReauthenticationPort implements ReauthenticationVerifier {
  private verifier: ReauthenticationVerifier | null = null;

  /** Called once by the auth module. A second binding is a wiring error. */
  bind(verifier: ReauthenticationVerifier): void {
    if (this.verifier !== null && this.verifier !== verifier) {
      throw new Error('ReauthenticationPort is already bound');
    }
    this.verifier = verifier;
  }

  async verify(principal: AuthenticatedUser, password: string): Promise<void> {
    if (this.verifier === null) {
      throw new Error('ReauthenticationPort is not bound: re-authentication is unavailable');
    }
    await this.verifier.verify(principal, password);
  }
}
