import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { PolicyService } from '../../../config';

/**
 * The access token (RM M6.2, MG §11.1-1).
 *
 * Claims are `sub / role / permissions / sid`, which the roadmap names,
 * plus `pid` — see below. The TTL comes from `PolicyService`, whose env
 * layer the schema caps at 900 seconds, so a 15-minute ceiling is
 * enforced at configuration time rather than trusted here.
 *
 * ## `sub` is the uuid, `pid` is the `usr_…`
 *
 * `SessionUser.id` in the frontend is `usr_doctor_amelia` — the value
 * the client renders — while every foreign key in the schema refers to
 * the uuid. A token carrying only one of them forces every guarded
 * handler to look the other up, on every request. Carrying both costs
 * about forty bytes and means a route that writes an audit row (which
 * quotes the public id) and a route that queries by user (which needs
 * the uuid) both work from the token alone.
 *
 * ## The claims are checked; the session is not trusted (PRE-01)
 *
 * `verify` checks the signature and the claim shapes, and nothing else.
 * Whether the *session* behind `sid` is still live is a separate question
 * that `AccessTokenGuard` asks of PostgreSQL on every protected request
 * (`SessionService.activePermissionVersion`; owner decisions I4, O-13).
 * The same read checks the `role` claim (ADR-046) and returns the
 * account's permission version, against which the `pv` claim is compared:
 * a mismatch means the `permissions` claim is stale and the guard replaces
 * it with a fresh resolution (G4, ADR-047). So neither claim is trusted
 * past the change that made it stale.
 *
 * ## `pv`
 *
 * `users.permission_version` as read *before* the permission claim was
 * resolved, so the claim is at least that new. Optional on the way in: a
 * token minted before the claim existed verifies, and the guard treats it
 * as stale (a re-resolution, not a 401).
 */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly pid: string;
  readonly role: string;
  readonly permissions: readonly string[];
  readonly sid: string;
  /** `users.permission_version` the `permissions` claim was resolved at (G4). */
  readonly pv?: number;
}

export interface IssuedAccessToken {
  readonly accessToken: string;
  /** Seconds, for the client's silent-refresh timer (API §1.2). */
  readonly expiresIn: number;
}

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly policy: PolicyService,
  ) {}

  async issue(user: AuthenticatedUser): Promise<IssuedAccessToken> {
    const { accessTtlSeconds } = await this.policy.current();

    const claims: AccessTokenClaims = {
      sub: user.id,
      pid: user.publicId,
      role: user.role,
      permissions: user.permissions,
      sid: user.sessionId,
      ...(user.permissionVersion === undefined ? {} : { pv: user.permissionVersion }),
    };

    return {
      accessToken: await this.jwt.signAsync(claims, { expiresIn: accessTtlSeconds }),
      expiresIn: accessTtlSeconds,
    };
  }

  /**
   * Verifies and narrows, or returns `null`.
   *
   * `null` rather than a throw because every caller answers the same
   * 401 whatever went wrong — expired, forged, truncated — and a
   * `try/catch` per call site is how one of them eventually returns 500
   * for a malformed header.
   */
  async verify(token: string): Promise<AuthenticatedUser | null> {
    let claims: unknown;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    } catch {
      return null;
    }

    return toPrincipal(claims);
  }
}

/**
 * Narrows the decoded payload.
 *
 * The signature proves the token came from this service, not that the
 * claims are the shape this version expects — a token minted before a
 * claim was added is still validly signed. Rejecting rather than
 * coercing means a stale token becomes a 401 the client recovers from
 * with a refresh, instead of a principal with `permissions: undefined`.
 */
function toPrincipal(claims: unknown): AuthenticatedUser | null {
  if (typeof claims !== 'object' || claims === null) return null;
  const record = claims as Record<string, unknown>;

  const sub = record['sub'];
  const pid = record['pid'];
  const role = record['role'];
  const sid = record['sid'];
  const permissions = record['permissions'];

  if (typeof sub !== 'string' || typeof pid !== 'string') return null;
  if (typeof role !== 'string' || typeof sid !== 'string') return null;
  if (!Array.isArray(permissions) || permissions.some((value) => typeof value !== 'string')) {
    return null;
  }

  // A `pv` that is not a non-negative integer is dropped rather than
  // refused: the guard treats an absent version as stale and re-resolves,
  // which is the safe reading of a claim it cannot compare.
  const pv = record['pv'];
  const permissionVersion =
    typeof pv === 'number' && Number.isSafeInteger(pv) && pv >= 0 ? pv : undefined;

  return {
    id: sub,
    publicId: pid,
    role,
    permissions: permissions as string[],
    sessionId: sid,
    ...(permissionVersion === undefined ? {} : { permissionVersion }),
  };
}
