import type { ApiError } from '@/types/api';

import type { AuthService, SignInResult } from '../model/types';

/**
 * The development auth adapter.
 *
 * ── What this is, and what it is not ─────────────────────────────────
 * It is a local stand-in so the sign-in, OTP, recovery and session-expiry
 * SCREENS can be built and tested before AD-1 is decided. It is **not** a
 * fake authentication backend (§11 of the brief): it grants nothing, it
 * verifies nothing, it issues strings that no server would accept, and
 * `env.ts` refuses to build a production bundle with mocks enabled.
 *
 * Behaviour is chosen to exercise the branches that matter rather than to
 * be convenient:
 *
 * - the wrong password produces `401 invalid_credentials`, which the
 *   client must NOT treat as an expired session (audit §5);
 * - one account requires an OTP step-up, so the step-up screen has a
 *   path to it;
 * - one account is unverified, so the verify-email screen does too;
 * - `forgotPassword` always resolves, whatever the address, which is the
 *   backend's anti-enumeration behaviour and not a shortcut.
 */

const DEMO_PASSWORD = 'Password1!';
const DEMO_OTP_CODE = '123456';
/** `setupTwoFactor`'s first code, normalised. */
const DEMO_RECOVERY_CODE = '11112222';

interface DemoAccount {
  readonly email: string;
  readonly displayName: string;
  readonly emailVerified: boolean;
  readonly requiresOtp: boolean;
}

const ACCOUNTS: readonly DemoAccount[] = [
  { email: 'sara@example.com', displayName: 'Sara Ahmed', emailVerified: true, requiresOtp: false },
  { email: 'otp@example.com', displayName: 'Omar Tahir', emailVerified: true, requiresOtp: true },
  {
    email: 'unverified@example.com',
    displayName: 'Nadia Farouk',
    emailVerified: false,
    requiresOtp: false,
  },
];

function fail(error: ApiError): never {
  throw Object.assign(new Error(`API error: ${error.kind}`), error);
}

function sessionFor(account: DemoAccount): SignInResult {
  return {
    tokens: {
      accessToken: `fixture-access-${account.email}`,
      refreshToken: `fixture-refresh-${account.email}`,
    },
    identity: {
      subjectId: `fixture-${account.email}`,
      displayName: account.displayName,
      email: account.email,
      emailVerified: account.emailVerified,
      role: 'patient',
    },
  };
}

function findAccount(email: string): DemoAccount | undefined {
  return ACCOUNTS.find((account) => account.email.toLowerCase() === email.trim().toLowerCase());
}

export const fixtureAuthService: AuthService = {
  async login(input) {
    const account = findAccount(input.email);
    if (account === undefined || input.password !== DEMO_PASSWORD) {
      // The exact shape the real backend returns for a wrong password.
      // `ApiClient` must NOT refresh on this (checklist D-02).
      fail({ kind: 'auth', code: 'invalid_credentials' });
    }
    if (account.requiresOtp) {
      return { kind: 'otp-required', otpToken: `fixture-otp-${account.email}` };
    }
    return { kind: 'authenticated', result: sessionFor(account) };
  },

  async verifyOtp(input) {
    const email = input.otpToken.replace('fixture-otp-', '');
    const account = findAccount(email);
    if (account === undefined) fail({ kind: 'auth', code: 'otp_invalid' });
    if (input.code !== '123456') fail({ kind: 'auth', code: 'otp_invalid' });
    return sessionFor(account);
  },

  async resendOtp() {
    // Resolves silently, as the real endpoint does.
  },

  async refresh(refreshToken) {
    const email = refreshToken.replace('fixture-refresh-', '');
    const account = findAccount(email);
    // The backend's one refusal for a dead refresh token:
    // `401 unauthorized` (`refresh.service.ts` `expiredSession`), which is
    // what `refresh-outcome.ts` reads as the session being over.
    if (account === undefined) fail({ kind: 'auth', code: 'unauthorized' });
    return sessionFor(account);
  },

  async logout() {
    // The real route revokes the session server-side; there is nothing
    // to revoke here. The local sweep is `useLogout`'s job either way.
  },

  async forgotPassword() {
    // Always resolves. The backend answers 202 whether or not the address
    // exists, and a fixture that answered differently would train the UI
    // to leak the difference.
  },

  async resetPassword() {},

  /**
   * The three branches the real route has, so the form is developed
   * against them rather than against a method that always resolves:
   *
   * - a wrong current password is `401 invalid_credentials` — the branch
   *   that must reach the field and NOT the session machinery (D-02);
   * - a new password equal to the current one is `422 weak_password`
   *   carrying `fieldErrors.newPassword`, which is how the server answers
   *   it (it compares against the stored hash, so a differently-cased
   *   copy is caught too — something a fixture cannot imitate and does
   *   not pretend to);
   * - anything else resolves, as a 204 does.
   *
   * The policy itself is NOT re-checked here. `strongPassword` in the
   * form schema is the same five rules as the server's, so a weak
   * password never reaches this call, and a fixture that re-implemented
   * the rule would be a third copy of it.
   */
  async changePassword(input) {
    if (input.currentPassword !== DEMO_PASSWORD) {
      fail({ kind: 'auth', code: 'invalid_credentials' });
    }
    if (input.newPassword === input.currentPassword) {
      fail({
        kind: 'validation',
        code: 'weak_password',
        fieldErrors: { newPassword: ['Choose a password you have not used here before'] },
      });
    }
    // A real change would revoke every other session. There is one
    // fixture session and it is this one, so there is nothing to revoke.
  },

  /**
   * 2FA, as the live routes behave (checklist D-16).
   *
   * The secret and codes below are FIXTURE values and are inert: nothing
   * validates against them, and a production build never reaches this
   * adapter (`env.ts` refuses `production` with mocks on). They exist so
   * the enrolment screen has something to render.
   */
  async setupTwoFactor(password) {
    // As the server does (owner decision D2): the password first.
    if (password !== DEMO_PASSWORD) {
      fail({ kind: 'auth', code: 'invalid_credentials' });
    }
    return {
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/Medora:sara@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Medora',
      recoveryCodes: ['1111-2222', '3333-4444', '5555-6666', '7777-8888'],
    };
  },

  async enableTwoFactor(code) {
    // The server checks the code against the shared secret and a clock.
    // A fixture cannot, so it accepts the demo code and refuses the rest
    // — enough to exercise both branches of the screen.
    if (code !== DEMO_OTP_CODE) {
      fail({
        kind: 'validation',
        code: 'otp_invalid',
        fieldErrors: { code: ['That code is not right. Check your authenticator app.'] },
      });
    }
  },

  async disableTwoFactor(password) {
    if (password !== DEMO_PASSWORD) {
      fail({ kind: 'auth', code: 'invalid_credentials' });
    }
  },

  /**
   * The demo's recovery code is the first one `setupTwoFactor` shows,
   * compared the way the server normalises (case, spaces and the dash).
   */
  async redeemRecoveryCode(input) {
    const email = input.otpToken.replace('fixture-otp-', '');
    const account = findAccount(email);
    if (account === undefined) fail({ kind: 'auth', code: 'otp_invalid' });
    if (input.recoveryCode.toLowerCase().replace(/[\s-]/g, '') !== DEMO_RECOVERY_CODE) {
      fail({ kind: 'auth', code: 'otp_invalid' });
    }
    return sessionFor(account);
  },

  /**
   * Unknown, as on an API that predates R2: the fixture keeps no factor
   * per account, and a state it made up would be the screen asserting
   * something nobody told it. The enrolment screen therefore offers both
   * actions, as it always has in the demo.
   */
  async twoFactorStatus() {
    return null;
  },

  async startTwoFactorReenrollment(input) {
    if (input.password !== DEMO_PASSWORD) fail({ kind: 'auth', code: 'invalid_credentials' });
    if (input.code !== DEMO_OTP_CODE) fail({ kind: 'auth', code: 'otp_invalid' });
    return {
      secret: 'KRSXG5CTMVRXEZLU',
      otpauthUrl: 'otpauth://totp/Medora:demo?secret=KRSXG5CTMVRXEZLU&issuer=Medora',
      enrolmentToken: 'fixture-enrolment',
    };
  },

  async confirmTwoFactorReenrollment(input) {
    if (input.code !== DEMO_OTP_CODE) fail({ kind: 'auth', code: 'otp_invalid' });
    return ['9999-0000', 'aaaa-bbbb', 'cccc-dddd', 'eeee-ffff'];
  },

  async verifyEmail() {},
  async resendVerification() {},

  /**
   * Mirrors the live 201 exactly: a next step and an address, no tokens.
   *
   * It used to return a fabricated session with `emailVerified: false`,
   * which the screen then read to decide *not* to adopt it — the right
   * behaviour reached through two invented credentials. ADR-035 §4 gives
   * the port a return type that cannot hold them.
   */
  async register(input) {
    if (findAccount(input.email) !== undefined) {
      fail({ kind: 'conflict', code: 'email_taken', detail: 'That email is already registered.' });
    }
    return { nextStep: 'verify-email' as const, email: input.email };
  },
};

/** Shown on the login screen in development builds only. */
export const FIXTURE_CREDENTIALS = {
  email: ACCOUNTS[0]?.email ?? '',
  password: DEMO_PASSWORD,
  otpCode: DEMO_OTP_CODE,
} as const;
