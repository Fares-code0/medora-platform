import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PrismaService } from '../../../shared/database';
import { IdentityRepository } from '../repositories/identity.repository';

import { EnvelopeService } from '../../../shared/crypto';
import { CredentialLockoutService } from './credential-lockout.service';
import { OTP_CHALLENGE_TTL_SECONDS } from './otp-challenge.service';
import { ReauthenticationService } from './reauthentication.service';
import { RecoveryCodeService } from './recovery-code.service';
import { SessionService } from './session.service';
import { TotpService, type TotpEnrolment } from './totp.service';

/**
 * TOTP enrolment (RM M6.4, API §2.9).
 *
 * ## Two steps, and why the first one does not turn 2FA on
 *
 * `setup` generates a secret and stores it; `enable` turns the flag on,
 * and only after the user has produced a code from it. Doing both at
 * once is how a user ends up locked out of their own account by a
 * mis-scanned QR: the flag would be true, the authenticator would hold a
 * different secret, and every subsequent sign-in would fail with no way
 * back in. Proving the round trip *before* the flag flips is the whole
 * point of the second call.
 *
 * A `setup` that is never followed by `enable` leaves an unused secret
 * on the row and nothing else — `users.two_factor_enabled` is what every
 * other path reads, and it is still false.
 *
 * ## Encrypted, not hashed
 *
 * The server has to re-derive the same six digits the user's app shows,
 * so the secret must be recoverable — `EnvelopeService`, AES-256-GCM,
 * `bytea` (DB §10). The recovery codes are stored the same way and for a
 * weaker reason: they *could* be hashed, and DB §10 asks for encryption.
 * Following the schema is the right call for a value the column already
 * names `recovery_codes_enc`.
 */
/** `GET /me/2fa` — the 2FA settings view (owner decision R2). */
export interface TwoFactorStatus {
  readonly enabled: boolean;
  /** Unused recovery codes. 0 when 2FA is off or no codes are stored. */
  readonly recoveryCodesRemaining: number;
}

/** `POST /me/2fa/reenroll` — the new factor, not yet in effect. */
export interface ReenrollmentStart {
  readonly otpauthUrl: string;
  readonly secret: string;
  /** Presented to `/reenroll/confirm` with a code from the new secret. */
  readonly enrolmentToken: string;
}

/** `POST /me/2fa/reenroll/confirm` — shown once, exactly as at setup. */
export interface ReenrollmentResult {
  readonly recoveryCodes: readonly string[];
}

interface ReenrollmentClaims {
  readonly typ: '2fa_reenroll';
  readonly sub: string;
  readonly sid: string;
  /** The new secret, envelope-encrypted, base64. */
  readonly sec: string;
  /** Digest of the factor being replaced: the token dies when it changes. */
  readonly bas: string;
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityRepository,
    private readonly totp: TotpService,
    private readonly envelope: EnvelopeService,
    private readonly sessions: SessionService,
    private readonly recoveryCodes: RecoveryCodeService,
    private readonly reauthentication: ReauthenticationService,
    private readonly lockout: CredentialLockoutService,
    private readonly jwt: JwtService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  /**
   * `GET /me/2fa` — whether 2FA is on, and how many recovery codes remain
   * (owner decision R2: the count is shown in the 2FA settings and nowhere
   * else, not in the redemption response and not in the mail).
   */
  async status(user: AuthenticatedUser): Promise<TwoFactorStatus> {
    const account = await this.identity.findById(user.id);
    if (account === null) throw AppException.notFound('Account not found');
    if (!account.twoFactorEnabled) return { enabled: false, recoveryCodesRemaining: 0 };

    const stored = this.recoveryCodes.open(account.credentials?.recoveryCodesEnc ?? null);
    return { enabled: true, recoveryCodesRemaining: stored?.digests.length ?? 0 };
  }

  /**
   * API §2.9 — `{ password }` → `{ otpauthUrl, secret, recoveryCodes }`.
   *
   * This is the **only** time the recovery codes are returned. They are
   * stored encrypted and never read back out to a caller, so a user who
   * loses them re-runs setup rather than asking for them again — which
   * is the property that makes them worth having.
   *
   * Owner decision D2 (2026-11-14): the current password first, for every
   * role. A session alone — a borrowed laptop, a stolen token — must not
   * be enough to bind the account to someone else's authenticator and walk
   * off with its recovery codes. Nothing is generated, stored or returned
   * until the password checks out, and the check is D1's: the same guess
   * budget and the same outcome at its limit.
   */
  async setup(user: AuthenticatedUser, password: string): Promise<TotpEnrolment> {
    const account = await this.identity.findById(user.id);
    if (account === null) throw AppException.notFound('Account not found');

    // Owner decision Q7 / R4: an account that already has a second factor
    // replaces it only through re-enrollment (password, current factor, new
    // factor proved). Before this check, a session alone could overwrite
    // the live secret and recovery codes here.
    if (account.twoFactorEnabled) {
      throw AppException.conflict(
        'Two-factor authentication is already enabled. Use re-enrollment to replace the factor.',
      );
    }

    // After the 409, deliberately: that answer does not depend on the
    // password, so it spends nothing from the guess budget.
    await this.reauthentication.verify(user, password);

    const enrolment = this.totp.enrol(account.email);

    await this.prisma.db.userCredential.update({
      where: { userId: user.id },
      data: {
        totpSecretEnc: this.envelope.encrypt(enrolment.secret),
        recoveryCodesEnc: this.recoveryCodes.seal(enrolment.recoveryCodes),
      },
    });

    await this.audit.record({
      action: 'auth.two_factor_setup',
      actor: { userId: user.id, role: user.role },
      entityType: 'user',
      entityId: user.publicId,
    });

    return enrolment;
  }

  /** API §2.9 — proves the round trip, then turns the flag on. */
  async enable(user: AuthenticatedUser, code: string): Promise<void> {
    const secret = await this.secretFor(user.id);
    if (secret === null) {
      throw AppException.conflict(
        'Run setup before enabling two-factor authentication',
        'conflict',
        'No enrolment in progress',
      );
    }

    if (!this.totp.verify(secret, code)) {
      throw AppException.unauthorized('otp_invalid', 'That code is not valid');
    }

    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });

    await this.recordActivity(user, 'Two-factor authentication enabled');
    await this.audit.record({
      action: 'auth.two_factor_enable',
      actor: { userId: user.id, role: user.role },
      entityType: 'user',
      entityId: user.publicId,
    });
  }

  /**
   * API §2.9 — `{ password }`.
   *
   * A password and not a TOTP code, which the contract fixes and which
   * is right: someone who has the phone and not the password is exactly
   * who must not be able to take the second factor off.
   *
   * Every other session is revoked. Turning 2FA off is a security
   * downgrade, and the plausible reason for an *unwanted* one is that
   * someone else is signed in.
   */
  async disable(user: AuthenticatedUser, password: string): Promise<void> {
    const account = await this.identity.findById(user.id);
    if (account?.credentials == null) throw AppException.notFound('Account not found');

    // ADR-035 §7 — an administrator may not take their own second factor
    // off. Checked before the password, deliberately: the answer does not
    // depend on the password, and verifying one first would spend an
    // Argon2id verification to reach a refusal that was never in doubt.
    //
    // This is what makes `login.service.ts`'s `two_factor_required` check
    // a backstop rather than a trap. Without it an administrator could
    // disable MFA here and lock themselves out at the next sign-in, with
    // no self-service way back — the refusal is the kinder outcome as
    // well as the safer one.
    if (account.role.code === 'admin') {
      throw AppException.forbidden(
        'Two-factor authentication is required for administrator accounts',
      );
    }

    // Owner decision D1 (2026-11-14): the password is checked against the
    // account's one guess budget, through the lock screen's check — a wrong
    // one is counted, the guess that reaches the limit locks the account and
    // revokes this session (429), a right one clears the counter.
    await this.reauthentication.verify(user, password);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } }),
      // The secret goes with the flag. Leaving it behind would mean a
      // later `enable` silently reactivated a secret the user believes
      // they removed.
      this.prisma.userCredential.update({
        where: { userId: user.id },
        data: { totpSecretEnc: null, recoveryCodesEnc: null },
      }),
    ]);

    await this.sessions.revokeAllFor(user.id);

    await this.recordActivity(user, 'Two-factor authentication disabled');
    await this.audit.record({
      action: 'auth.two_factor_disable',
      actor: { userId: user.id, role: user.role },
      entityType: 'user',
      entityId: user.publicId,
    });
  }

  /**
   * `POST /me/2fa/reenroll` — steps 1–3 of owner decision Q7 / R4.
   *
   * 1. The current password, through the lock screen's re-authentication:
   *    the same guess budget as sign-in, audited, and the guess that locks
   *    the account revokes this session.
   * 2. A code from the **current** authenticator. A wrong one spends from
   *    that same budget, so holding a session and the password does not
   *    buy an unbounded search of six-digit codes.
   * 3. A new secret, returned for the user to add to their authenticator.
   *
   * Nothing is stored. The old factor and the existing recovery codes stay
   * exactly as they are, and keep working, until `completeReenrollment`
   * succeeds. The new secret travels in a signed token bound to this user,
   * this session and the factor it replaces, and lives for the step-up
   * window (`OTP_CHALLENGE_TTL_SECONDS`).
   *
   * A user whose current factor is unavailable cannot use this route. Q7
   * requires a separately approved secure account-recovery process for
   * that case, and none is defined.
   */
  async startReenrollment(
    user: AuthenticatedUser,
    password: string,
    code: string,
  ): Promise<ReenrollmentStart> {
    const account = await this.identity.findById(user.id);
    if (account === null) throw AppException.notFound('Account not found');
    const replacing = account.credentials?.totpSecretEnc ?? null;
    if (!account.twoFactorEnabled || replacing === null) {
      throw AppException.conflict('Two-factor authentication is not enabled. Use setup instead.');
    }

    await this.reauthentication.verify(user, password);

    const current = await this.secretFor(user.id);
    if (current === null || !this.totp.verify(current, code)) {
      const locked = await this.lockout.recordFailure(user.id);
      if (locked > 0) {
        await this.sessions.revoke(user.sessionId);
        throw AppException.rateLimited(locked, 'Too many failed attempts');
      }
      throw AppException.unauthorized('otp_invalid', 'That code is not valid');
    }

    const enrolment = this.totp.enrol(account.email);
    const claims: ReenrollmentClaims = {
      typ: '2fa_reenroll',
      sub: user.id,
      sid: user.sessionId,
      sec: Buffer.from(this.envelope.encrypt(enrolment.secret)).toString('base64'),
      bas: digestOf(replacing),
    };

    await this.audit.record({
      action: 'auth.two_factor_reenroll_started',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'user',
      entityId: user.publicId,
    });

    return {
      otpauthUrl: enrolment.otpauthUrl,
      secret: enrolment.secret,
      enrolmentToken: await this.jwt.signAsync(claims, { expiresIn: OTP_CHALLENGE_TTL_SECONDS }),
    };
  }

  /**
   * `POST /me/2fa/reenroll/confirm` — steps 4–5 of owner decision Q7 / R4.
   *
   * The new factor is proved with a code from the new secret, and only then
   * are the secret and the recovery codes replaced, in one row update under
   * a lock. The token names the factor it replaces, so it cannot be applied
   * twice, nor after the factor changed by any other route; either case is
   * 409. The new recovery codes are returned here, once.
   */
  async completeReenrollment(
    user: AuthenticatedUser,
    enrolmentToken: string,
    code: string,
  ): Promise<ReenrollmentResult> {
    const claims = await this.reenrollmentClaims(enrolmentToken, user);
    if (claims === null) throw AppException.unauthorized('token_invalid', 'Enrollment is not valid');

    const secret = this.decryptOrNull(claims.sec);
    if (secret === null) throw AppException.unauthorized('token_invalid', 'Enrollment is not valid');

    if (!this.totp.verify(secret, code)) {
      throw AppException.unauthorized('otp_invalid', 'That code is not valid');
    }

    const recoveryCodes = this.totp.newRecoveryCodes();

    const replaced = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM user_credentials WHERE user_id = ${user.id}::uuid FOR UPDATE`;

      const credential = await tx.userCredential.findUnique({
        where: { userId: user.id },
        select: { totpSecretEnc: true, user: { select: { twoFactorEnabled: true } } },
      });
      const current = credential?.totpSecretEnc ?? null;
      if (
        credential === null ||
        current === null ||
        !credential.user.twoFactorEnabled ||
        digestOf(current) !== claims.bas
      ) {
        return false;
      }

      await tx.userCredential.update({
        where: { userId: user.id },
        data: {
          totpSecretEnc: this.envelope.encrypt(secret),
          recoveryCodesEnc: this.recoveryCodes.seal(recoveryCodes),
        },
      });
      return true;
    });

    if (!replaced) {
      throw AppException.conflict(
        'This enrollment no longer applies: the factor it replaces has changed.',
      );
    }

    await this.recordActivity(user, 'Two-factor authentication re-enrolled');
    await this.audit.record({
      action: 'auth.two_factor_reenrolled',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'user',
      entityId: user.publicId,
    });

    return { recoveryCodes };
  }

  /**
   * The enrolled secret in plaintext, or `null`.
   *
   * Decryption failure is `null` rather than a throw: a row whose
   * ciphertext no longer authenticates is a corrupt second factor, and
   * the honest answer to "what is this user's secret" is that there
   * isn't one. The verification then fails, which is the safe direction.
   */
  async secretFor(userId: string): Promise<string | null> {
    const credential = await this.prisma.db.userCredential.findUnique({
      where: { userId },
      select: { totpSecretEnc: true },
    });

    if (credential?.totpSecretEnc == null) return null;

    try {
      return this.envelope.decrypt(credential.totpSecretEnc);
    } catch {
      return null;
    }
  }

  /** A base64 envelope from a re-enrollment token, decrypted, or `null`. */
  private decryptOrNull(sealed: string): string | null {
    try {
      return this.envelope.decrypt(Buffer.from(sealed, 'base64'));
    } catch {
      return null;
    }
  }

  /** The claims of a re-enrollment token issued to this user and session, or `null`. */
  private async reenrollmentClaims(
    token: string,
    user: AuthenticatedUser,
  ): Promise<ReenrollmentClaims | null> {
    let claims: Partial<ReenrollmentClaims>;
    try {
      claims = await this.jwt.verifyAsync<Partial<ReenrollmentClaims>>(token);
    } catch {
      return null;
    }
    // A signed access or step-up token is also a signed token; only this
    // type, for this user and this session, is a re-enrollment.
    if (claims.typ !== '2fa_reenroll' || claims.sub !== user.id || claims.sid !== user.sessionId) {
      return null;
    }
    if (typeof claims.sec !== 'string' || typeof claims.bas !== 'string') return null;
    return claims as ReenrollmentClaims;
  }

  /**
   * The user-facing feed (DB §A12), not the platform ledger.
   *
   * Both are written for a security change: `user_activity_log` is what
   * the account owner sees in Settings → Activity, and `audit_events` is
   * what an administrator investigates. Writing only one would leave
   * either the user or the investigation blind.
   */
  private async recordActivity(user: AuthenticatedUser, summary: string): Promise<void> {
    // Through the M8.6 recorder, which swallows and logs a write
    // failure. A direct `create` here would let one propagate and fail a
    // 2FA enrolment that has already taken effect — leaving the user's
    // authenticator enrolled while the response said it was not.
    await this.activity.record({ userId: user.id, kind: 'security', summary });
  }
}

/** A stable fingerprint of a stored secret's ciphertext. Not secret itself. */
function digestOf(ciphertext: Uint8Array): string {
  return createHash('sha256').update(ciphertext).digest('hex');
}
