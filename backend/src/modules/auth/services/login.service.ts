import { randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { PolicyService } from '../../../config';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { LoginResult, UserStatus } from '../../../generated/prisma/enums';
import type { LoginInput } from '../dto/login.schema';
import { IdentityRepository, type UserWithCredentials } from '../repositories/identity.repository';

import { AccessTokenService } from './access-token.service';
import { CredentialLockoutService } from './credential-lockout.service';
import { LoginEventService } from './login-event.service';
import { OtpChallengeService } from './otp-challenge.service';
import { PasswordService } from './password.service';
import { PermissionService } from './permission.service';
import { SessionService } from './session.service';

/**
 * `POST /auth/login` (RM M6.2, API §1.2).
 *
 * ## The order of the checks is the contract
 *
 * lockout → password → email verified → account status → second factor.
 * Three of those placements matter and would be easy to get wrong:
 *
 * **Lockout is checked before the password**, so a locked account costs
 * an attacker a 429 rather than an Argon2id verification. Checking it
 * after would turn the lockout into a rate limiter that still does the
 * expensive work.
 *
 * **`email_unverified` is checked after the password.** API §1.2 lists
 * it second for a reason: answering it before would let anyone discover
 * which addresses have unverified accounts without knowing a password.
 *
 * **`account_inactive` is checked after the password too**, and for
 * exactly the same reason (ADR-035 §6). Answering "this account is
 * suspended" to an unauthenticated caller would let anyone enumerate
 * which of a clinic's staff have been suspended — which is a question
 * about employment, not about software.
 *
 * ## `users.status` is enforced here, and was not before ADR-035
 *
 * `findByEmail` filters soft-deleted accounts, so a *deactivated* user
 * could never sign in. But `UserStatus` has three other non-ACTIVE
 * values — INACTIVE, SUSPENDED, LOCKED — and nothing in this file read
 * the column, so an administrator who suspended an account was changing
 * a value that stopped nothing. Suspension is the lever an administrator
 * reaches for when an account is compromised or a clinician's practising
 * rights are withdrawn, and it has to actually close the door.
 *
 * ## Failure looks identical whatever went wrong
 *
 * An unknown address and a wrong password both produce 401
 * `invalid_credentials`, with the same body — and, because an unknown
 * address is still verified against a dummy hash, in the same time. A
 * login endpoint that answers faster for an address it has never seen is
 * an account enumeration oracle with extra steps.
 *
 * The one deliberate exception is the lockout 429, which only a real
 * account can produce. That is inherent to having a lockout at all: the
 * contract asks for one (API §1.2, MG §11.1-8), and the alternative —
 * pretending to lock out unknown addresses — would need per-address
 * server state for addresses that do not exist. Recorded in ADR-025
 * rather than left as an unremarked hole.
 */
export interface SessionUserPayload {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

export interface AuthenticatedPayload {
  readonly user: SessionUserPayload;
  readonly accessToken: string;
  readonly expiresIn: number;
}

/** What the controller needs to set the cookie, alongside the body. */
export interface LoginSuccess {
  readonly kind: 'session';
  readonly payload: AuthenticatedPayload;
  readonly refreshToken: string;
  readonly refreshTtlSeconds: number;
}

export interface LoginStepUp {
  readonly kind: 'otp';
  readonly payload: { readonly requiresOtp: true; readonly otpToken: string };
}

export type LoginOutcome = LoginSuccess | LoginStepUp;

export interface RequestContext {
  readonly ipAddress?: string | undefined;
  readonly device?: string | undefined;
}

@Injectable()
export class LoginService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly permissions: PermissionService,
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
    private readonly loginEvents: LoginEventService,
    private readonly otp: OtpChallengeService,
    private readonly policy: PolicyService,
    private readonly lockout: CredentialLockoutService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  /**
   * An Argon2id hash of a value nobody knows, verified against when no
   * account matches so the two paths take the same time.
   *
   * Hashed **once**, lazily, and held as a promise: the cost that has to
   * match is the *verification*, which is what the real path spends, and
   * hashing a fresh dummy per unknown address would spend twice that.
   * A hand-written constant would have been simpler and wrong — an
   * unparseable hash fails fast, which is the opposite of the property
   * this exists for.
   */
  private absentAccountHash: Promise<string> | undefined;

  private decoyHash(): Promise<string> {
    this.absentAccountHash ??= this.passwords.hash(randomBytes(32).toString('base64url'));
    return this.absentAccountHash;
  }

  async login(input: LoginInput, context: RequestContext = {}): Promise<LoginOutcome> {
    const email = input.email.trim();
    const user = await this.identity.findByEmail(email);

    if (user === null) {
      // Spend the same time a real verification would, then answer the
      // same way. `await` and not fire-and-forget: the point is the delay.
      await this.passwords.verify(await this.decoyHash(), input.password);
      await this.fail(email, undefined, 'invalid_credentials', context);
      throw invalidCredentials();
    }

    const lockedFor = this.lockout.remainingSeconds(user.credentials);
    if (lockedFor > 0) {
      await this.fail(email, user.id, 'rate_limited', context);
      throw AppException.rateLimited(lockedFor, 'Too many failed attempts');
    }

    const credentials = user.credentials;
    const verified =
      credentials !== null &&
      (await this.passwords.verify(credentials.passwordHash, input.password));

    if (!verified) {
      const locked = credentials === null ? 0 : await this.lockout.recordFailure(user.id);
      await this.fail(email, user.id, locked > 0 ? 'rate_limited' : 'invalid_credentials', context);
      if (locked > 0) throw AppException.rateLimited(locked, 'Too many failed attempts');
      throw invalidCredentials();
    }

    if (user.emailVerifiedAt === null) {
      await this.fail(email, user.id, 'email_unverified', context);
      throw new AppException(HttpStatus.FORBIDDEN, {
        message: 'Verify your email address before signing in',
        code: 'email_unverified',
      });
    }

    // ADR-035 §6. One code for all three non-ACTIVE states: the caller
    // has proved the password, so this is not an enumeration surface —
    // but "suspended" and "locked" carry different implications about a
    // person, and the account holder learns which from their
    // administrator rather than from a login form.
    if (user.status !== UserStatus.ACTIVE) {
      await this.fail(email, user.id, 'account_inactive', context);
      throw new AppException(HttpStatus.FORBIDDEN, {
        message: 'This account is not active. Contact your administrator.',
        code: 'account_inactive',
      });
    }

    // Multi-hospital §2.6: a doctor whose employment ended (or a staff
    // member whose affiliation ended), with none active, may not sign in.
    // The same code as a suspended account: the holder learns the reason
    // from their administrator, not from the login form.
    if (await this.permissions.isTerminated(user.id, user.role.code)) {
      await this.fail(email, user.id, 'account_inactive', context);
      throw new AppException(HttpStatus.FORBIDDEN, {
        message: 'This account is not active. Contact your administrator.',
        code: 'account_inactive',
      });
    }

    // A successful password check clears the counter (on success only;
    // see `CredentialLockoutService.clear`).
    await this.lockout.clear(user.id);

    // ADR-035 §7 — an administrator signs in with a second factor or not
    // at all.
    //
    // This is a refusal rather than a challenge because there is nothing
    // to challenge with: an account that has never enrolled has no TOTP
    // secret, so `OtpChallengeService.issue` would mint a code nobody can
    // produce. The invitation flow is what makes the state unreachable
    // for accounts created the supported way — an invited administrator
    // cannot reach ACTIVE without enrolling — and `TwoFactorService
    // .disable` refuses to take the factor back off. This check is the
    // backstop for the paths those two do not cover: an account whose
    // role was changed to `admin` after the fact, or one seeded directly.
    if (isPrivilegedRole(user.role.code) && !user.twoFactorEnabled) {
      await this.fail(email, user.id, 'two_factor_required', context);
      throw new AppException(HttpStatus.FORBIDDEN, {
        message: 'This account requires two-factor authentication. Contact your administrator.',
        code: 'two_factor_required',
      });
    }

    // The platform-wide policy meets the same wall the administrator
    // backstop above does: an account that has never enrolled has no
    // secret to challenge against. Issuing the challenge anyway put the
    // user on a code screen no code could pass, answering `otp_invalid`
    // until the attempts ran out. ADR-035 §7's reason for refusing rather
    // than challenging applies to every role the policy reaches.
    const { twoFactorRequired } = await this.policy.current();
    if (twoFactorRequired && !user.twoFactorEnabled) {
      await this.fail(email, user.id, 'two_factor_required', context);
      throw new AppException(HttpStatus.FORBIDDEN, {
        message: 'This account requires two-factor authentication. Contact your administrator.',
        code: 'two_factor_required',
      });
    }

    if (user.twoFactorEnabled) {
      const challenge = await this.otp.issue(user.id, input.rememberMe);
      // Not a failure and not yet a success: the password was right, and
      // M8.5's history should not show a gap where a step-up happened.
      // The `SUCCESS` row is written when the session is actually created.
      return { kind: 'otp', payload: { requiresOtp: true, otpToken: challenge.otpToken } };
    }

    return this.establishSession(user, input.rememberMe, context);
  }

  /**
   * Mints the session, the access token and the audit trail.
   *
   * Shared with M6.4's step-up so the two paths cannot drift: a session
   * created after a second factor must be indistinguishable from one
   * created without.
   */
  async establishSession(
    user: UserWithCredentials,
    rememberMe: boolean,
    context: RequestContext = {},
  ): Promise<LoginSuccess> {
    const permissions = await this.permissions.resolve(user.id, user.roleId, user.role.code);
    const issued = await this.sessions.start(user.id, rememberMe, context);

    const principal: AuthenticatedUser = {
      id: user.id,
      publicId: user.publicId,
      role: user.role.code,
      permissions,
      sessionId: issued.session.id,
    };

    const { accessToken, expiresIn } = await this.accessTokens.issue(principal);

    await this.loginEvents.record({
      attemptedEmail: user.email,
      userId: user.id,
      result: LoginResult.SUCCESS,
      ...context,
    });

    await this.audit.record({
      action: 'auth.login',
      actor: {
        userId: user.id,
        role: user.role.code,
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
      },
      entityType: 'session',
      entityId: issued.session.id,
      metadata: { rememberMe, twoFactor: user.twoFactorEnabled },
    });

    /*
     * The `login` activity row — M29.1.
     *
     * `login` was the one of `ActivityKind`'s seven members that nothing
     * wrote: the enum had it, `ACTIVITY_KIND_LABELS` rendered it, and the
     * Settings → Activity filter offered a category that was always
     * empty. A filter that can only ever return nothing is worse than an
     * absent one, because the user reads it as "I have never signed in".
     *
     * **Both rows, not one.** `login_events` (M6.2) is the security
     * record — every attempt, successes and failures, with the lockout
     * counter reading it. This is the *user's own* feed, so it carries
     * only what a person wants to see about their own account, in the
     * prose `summary` the panel renders verbatim. `shared/activity`'s
     * header states that division, and a security-relevant change
     * writing to both is the rule rather than duplication.
     *
     * No PHI and no secrets: the device string is what the user's own
     * Security panel already shows them about their sessions.
     */
    await this.activity.record({
      userId: user.id,
      kind: 'login',
      summary: 'Signed in',
      ...(context.device === undefined ? {} : { detail: context.device }),
    });

    return {
      kind: 'session',
      payload: {
        user: {
          id: user.publicId,
          name: user.displayName,
          email: user.email,
          role: user.role.code,
          permissions,
        },
        accessToken,
        expiresIn,
      },
      refreshToken: issued.refreshToken,
      refreshTtlSeconds: issued.ttlSeconds,
    };
  }

  private async fail(
    attemptedEmail: string,
    userId: string | undefined,
    failureCode: string,
    context: RequestContext,
  ): Promise<void> {
    await this.loginEvents.record({
      attemptedEmail,
      userId,
      result: LoginResult.FAILED,
      failureCode,
      ...context,
    });
  }
}

/**
 * Roles for which a second factor is not optional (ADR-035 §7).
 *
 * `admin` alone today. The list is a function rather than an inline
 * `=== 'admin'` because the sensitivity that justifies it is *what the
 * role can reach*, not its name — `roles.manage` and
 * `settings.manageSystem` are what make an administrator worth
 * compromising — and the next role to hold those capabilities should be
 * added here rather than discovered to have been exempt.
 *
 * Doctors are deliberately not on it. ADR-035 §7 has MFA "strongly
 * recommended" for clinicians rather than required, and turning it on
 * for every existing doctor account at once would lock out every
 * clinician who has not enrolled — a platform-wide outage delivered as a
 * security improvement. The global `twoFactorRequired` policy flag is
 * the supported way to raise the floor for everyone, and an
 * administrator can already turn it on.
 */
function isPrivilegedRole(roleCode: string): boolean {
  return roleCode === 'admin';
}

/**
 * 401 `invalid_credentials` — the code `LoginPage` branches on.
 *
 * One factory, so the unknown-address path and the wrong-password path
 * cannot drift into two subtly different bodies.
 */
function invalidCredentials(): AppException {
  return AppException.unauthorized('invalid_credentials', 'Invalid email or password');
}
