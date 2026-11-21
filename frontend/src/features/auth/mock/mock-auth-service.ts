import { AuthError } from '@/types/auth';
import type {
  AuthService,
  AuthSession,
  LoginInput,
  LoginOutcome,
  PendingSignIn,
  RegisterInput,
  RegisterResult,
} from '@/types/auth';

import { withLatency } from './delay';
import { clearSession, persistSession, refreshSession } from './session-store';
import { findUser, toSessionUser } from './users';

/**
 * The auth service, faked — the mock half of the DP-04 seam.
 *
 * Every function is async with realistic latency and rejects with a coded
 * `AuthError`, exactly as the HTTP adapter beside it does. Behaviour is
 * unchanged from the pre-seam mock: the same seeded accounts, the same
 * branch flows (`unverified@` → verify-email, `secure@` → verify-otp),
 * the same magic OTP and the same "invalid" token.
 *
 * What changed is the *shape*: it now implements `AuthService`, which is
 * transcribed from the backend. The adapting happens here rather than in
 * the provider, so the fake backend is what bends around the real
 * contract instead of the other way round.
 */

const VALID_OTP = '123456';
/**
 * The demo accounts' one recovery code, in the server's `xxxxx-xxxxx` hex
 * shape. Normalised the way `RecoveryCodeService` does (case, spaces and the
 * dash ignored), so the mock accepts what the server would.
 */
const VALID_RECOVERY_CODE = '0a1b2c3d4e';
/** A reset/verification token literally equal to this is treated as expired. */
const INVALID_TOKEN = 'invalid';

/**
 * The mock has no tokens: sessions are a `localStorage` snapshot and
 * requests are never made, so there is nothing for a bearer token to
 * authorize. An empty string keeps `AuthSession` honest — `ApiClient`
 * omits the `Authorization` header entirely for a falsy token — rather
 * than inventing a credential-shaped string that means nothing.
 */
function mockSession(user: ReturnType<typeof toSessionUser>): AuthSession {
  return { user, accessToken: '', expiresIn: 0 };
}

/** Completes a sign-in that was suspended for OTP or email verification. */
function completePending(pending: PendingSignIn | null): AuthSession | null {
  if (!pending) return null;
  const record = findUser(pending.email);
  return record ? mockSession(toSessionUser(record)) : null;
}

export const mockAuthService: AuthService = {
  restore(): Promise<AuthSession | null> {
    // The mock silent refresh (Phase 19): re-issues the fake token and
    // slides the expiry window forward, the stand-in for the httpOnly
    // refresh-token exchange the HTTP adapter really performs on boot.
    const restored = refreshSession();
    return Promise.resolve(restored ? mockSession(restored) : null);
  },

  async login(input: LoginInput): Promise<LoginOutcome> {
    const record = findUser(input.email);
    if (!record || record.password !== input.password) {
      return Promise.reject(new AuthError('invalid_credentials'));
    }
    await withLatency(null);
    if (!record.emailVerified) throw new AuthError('email_unverified');
    // A challenge, not a failure — matching `POST /auth/login`'s two
    // success shapes. The mock has no otpToken to hand back, so the
    // pending sign-in it creates carries `otpToken: null`.
    if (record.twoFactorEnabled) return { kind: 'otp', otpToken: '' };
    return { kind: 'session', session: mockSession(toSessionUser(record)) };
  },

  async verifyOtp(code: string, pending: PendingSignIn | null): Promise<AuthSession | null> {
    await withLatency(null);
    if (code !== VALID_OTP) throw new AuthError('otp_invalid');
    return completePending(pending);
  },

  async redeemRecoveryCode(
    recoveryCode: string,
    pending: PendingSignIn | null,
  ): Promise<AuthSession | null> {
    await withLatency(null);
    if (recoveryCode.toLowerCase().replace(/[\s-]/g, '') !== VALID_RECOVERY_CODE) {
      throw new AuthError('otp_invalid');
    }
    return completePending(pending);
  },

  async resendOtp(): Promise<void> {
    await withLatency(null, 200, 500);
  },

  async verifyEmail(token: string, pending: PendingSignIn | null): Promise<AuthSession | null> {
    await withLatency(null);
    if (token === INVALID_TOKEN) throw new AuthError('token_invalid');
    return completePending(pending);
  },

  async resendVerification(): Promise<void> {
    await withLatency(null, 200, 500);
  },

  /** Seeded emails collide; others proceed to verification. */
  async register(input: RegisterInput): Promise<RegisterResult> {
    await withLatency(null);
    if (findUser(input.email)) throw new AuthError('email_taken');
    return { nextStep: 'verify-email', email: input.email };
  },

  /** Always resolves — never reveals whether an account exists. */
  async forgotPassword(email: string): Promise<void> {
    void email;
    await withLatency(null);
  },

  async resetPassword(token: string, password: string): Promise<void> {
    void password;
    await withLatency(null);
    if (token === INVALID_TOKEN) throw new AuthError('token_invalid');
  },

  /**
   * Checks the password against the seeded record — no network, and no
   * new session: the one already in memory simply resumes, which is what
   * a lock screen ought to do and what the backend cannot yet offer.
   */
  async reauthenticate(email: string, password: string): Promise<AuthSession | null> {
    const record = findUser(email);
    if (!record || record.password !== password) {
      return Promise.reject(new AuthError('invalid_credentials'));
    }
    await withLatency(null, 150, 300);
    return null;
  },

  async logout(): Promise<void> {
    await withLatency(null, 150, 300);
  },

  persist(session: AuthSession, rememberMe: boolean): void {
    persistSession(session.user, rememberMe);
  },

  clear(): void {
    clearSession();
  },
};
