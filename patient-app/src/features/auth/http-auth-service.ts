import { accountEndpoints } from '@/api/endpoints/account';
import { authEndpoints } from '@/api/endpoints/auth';
import { isApiError } from '@/types/api';

import type { AuthenticatedIdentity, AuthService, LoginOutcome, SignInResult } from './model/types';

/**
 * The HTTP adapter, mapping the wire shapes onto the port.
 *
 * The mapping is where "which fields does a patient identity have?" is
 * answered defensively rather than assumed: `firstName`/`lastName` are
 * optional in the response schema because the shape of a patient
 * principal is AD-1's to decide, so `displayName` falls back to the local
 * part of the email rather than rendering "undefined undefined".
 */

interface WireSession {
  readonly data: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly user: {
      readonly id: string;
      readonly email: string;
      readonly name?: string | undefined;
      readonly firstName?: string | undefined;
      readonly lastName?: string | undefined;
      readonly emailVerified?: boolean | undefined;
    };
  };
}

function toIdentity(user: WireSession['data']['user']): AuthenticatedIdentity {
  const name =
    (user.name ?? '').trim() || [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    subjectId: user.id,
    displayName: name.length > 0 ? name : (user.email.split('@')[0] ?? 'there'),
    email: user.email,
    emailVerified: user.emailVerified ?? false,
  };
}

function toSignInResult(response: WireSession): SignInResult {
  return {
    tokens: {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
    },
    identity: toIdentity(response.data.user),
  };
}

export const httpAuthService: AuthService = {
  async login(input): Promise<LoginOutcome> {
    const response = await authEndpoints.login({
      email: input.email,
      password: input.password,
      rememberMe: input.rememberMe,
    });
    if ('otpToken' in response.data) {
      return { kind: 'otp-required', otpToken: response.data.otpToken };
    }
    return { kind: 'authenticated', result: toSignInResult(response as WireSession) };
  },

  async verifyOtp(input) {
    return toSignInResult(await authEndpoints.verifyOtp(input));
  },

  async resendOtp(otpToken) {
    await authEndpoints.resendOtp({ otpToken });
  },

  async refresh(refreshToken) {
    return toSignInResult(await authEndpoints.refresh({ refreshToken }));
  },

  async logout() {
    await authEndpoints.logout();
  },

  async forgotPassword(email) {
    await authEndpoints.forgotPassword({ email });
  },

  async resetPassword(input) {
    await authEndpoints.resetPassword(input);
  },

  /**
   * The one account route that is built. 204 on success, so there is
   * nothing to map — the absence of a throw is the result.
   */
  async changePassword(input) {
    await accountEndpoints.changePassword(input);
  },

  async setupTwoFactor(password) {
    return accountEndpoints.setupTwoFactor({ password });
  },

  async enableTwoFactor(code) {
    await accountEndpoints.enableTwoFactor({ code });
  },

  async disableTwoFactor(password) {
    await accountEndpoints.disableTwoFactor({ password });
  },

  async redeemRecoveryCode(input) {
    // Trimmed and otherwise as typed: the server normalises case, spaces
    // and the dash, and a value not shaped like a code is an ordinary
    // wrong code (401) rather than a 422 that would coach a guesser.
    return toSignInResult(
      await authEndpoints.redeemRecoveryCode({
        otpToken: input.otpToken,
        recoveryCode: input.recoveryCode.trim(),
      }),
    );
  },

  /**
   * A 404 is an API without the route (one that predates R2): the client
   * does not know the state, which is `null`, not an error. Anything else
   * is a real failure and surfaces as one.
   */
  async twoFactorStatus() {
    try {
      return await accountEndpoints.twoFactorStatus();
    } catch (error) {
      if (isApiError(error) && error.kind === 'not_found') return null;
      throw error;
    }
  },

  async startTwoFactorReenrollment(input) {
    return accountEndpoints.startTwoFactorReenrollment(input);
  },

  async confirmTwoFactorReenrollment(input) {
    return accountEndpoints.confirmTwoFactorReenrollment(input);
  },

  async verifyEmail(token) {
    await authEndpoints.verifyEmail({ token });
  },

  async resendVerification(email) {
    await authEndpoints.resendVerification({ email });
  },

  /**
   * `POST /auth/register` (ADR-035 §4).
   *
   * The endpoint adds `role: 'patient'`; this adapter forwards the
   * account fields and nothing else. The 201 body is unwrapped from the
   * `{ data: … }` envelope by the endpoint's schema.
   */
  async register(input) {
    const { data } = await authEndpoints.register({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      password: input.password,
      acceptTerms: input.acceptTerms,
      acceptPrivacy: input.acceptPrivacy,
    });

    return { nextStep: data.nextStep, email: data.email };
  },
};
