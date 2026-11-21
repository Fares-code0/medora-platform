import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/api/client';
import { isAuthError, ReauthLockoutError, UnsupportedRoleError } from '@/types/auth';

import { httpAuthService } from './auth';

/**
 * The HTTP auth adapter — FRONTEND_CHECKLIST §2 A-12 / §6 DP-04.
 *
 * Every fixture in this file is a **real** body, captured from
 * `backend/src/modules/auth` running locally, not a shape invented to
 * match the client. That is the point: these tests are what would fail
 * if the backend's envelope, its status codes or its machine codes moved.
 */

const REAL_LOGIN_PAYLOAD = {
  data: {
    user: {
      id: 'usr_5q3Q3ItSSmfJiUJn',
      name: 'Dr. Seam Tester',
      email: 'seam.tester@medora.health',
      role: 'doctor',
      permissions: [
        'ai.use',
        'appointments.manageOwn',
        'communications.viewMetadata',
        'labs.review',
        'messages.send',
        'patients.revealIdentity',
        'patients.view',
        'prescriptions.create',
        'records.edit',
        'records.view',
      ],
    },
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.header.signature',
    expiresIn: 900,
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
}

function lastCall(): { url: URL; body: unknown } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was never called');
  const init = call[1] as RequestInit;
  return {
    url: call[0] as URL,
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  if (!globalThis.crypto?.randomUUID) {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-correlation-id' });
  }
  apiClient.setAccessToken(null);
  apiClient.setUnauthorizedHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  apiClient.setAccessToken(null);
  apiClient.setUnauthorizedHandler(null);
});

describe('httpAuthService.login', () => {
  it('unwraps the { data } envelope the backend wraps every success in', async () => {
    fetchMock.mockImplementation(json(REAL_LOGIN_PAYLOAD));

    const outcome = await httpAuthService.login({
      email: 'seam.tester@medora.health',
      password: 'Medora123!',
      rememberMe: true,
    });

    expect(outcome.kind).toBe('session');
    if (outcome.kind !== 'session') throw new Error('expected a session');
    expect(outcome.session.user.name).toBe('Dr. Seam Tester');
    expect(outcome.session.expiresIn).toBe(900);
    expect(lastCall().url.pathname).toBe('/api/v1/auth/login');
  });

  it('sends rememberMe, which chooses the refresh TTL server-side', async () => {
    fetchMock.mockImplementation(json(REAL_LOGIN_PAYLOAD));

    await httpAuthService.login({ email: 'a@b.co', password: 'p', rememberMe: true });

    expect(lastCall().body).toEqual({ email: 'a@b.co', password: 'p', rememberMe: true });
  });

  it('puts the access token into ApiClient so the next request carries it', async () => {
    fetchMock.mockImplementation(json(REAL_LOGIN_PAYLOAD));

    await httpAuthService.login({ email: 'a@b.co', password: 'p', rememberMe: false });
    await apiClient.get('/patients');

    const headers = (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['Authorization']).toBe(`Bearer ${REAL_LOGIN_PAYLOAD.data.accessToken}`);
  });

  it('treats a 2FA challenge as a success, not a failure', async () => {
    // The backend answers 200 with no cookie: the password was right and
    // there is no session yet.
    fetchMock.mockImplementation(json({ data: { requiresOtp: true, otpToken: 'otp_handle_1' } }));

    const outcome = await httpAuthService.login({
      email: 'a@b.co',
      password: 'p',
      rememberMe: false,
    });

    expect(outcome).toEqual({ kind: 'otp', otpToken: 'otp_handle_1' });
  });

  it('maps 401 invalid_credentials onto the code LoginPage branches on', async () => {
    fetchMock.mockImplementation(
      json({ message: 'Invalid email or password', code: 'invalid_credentials' }, 401),
    );

    await expect(
      httpAuthService.login({ email: 'a@b.co', password: 'wrong', rememberMe: false }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('maps 403 email_unverified — a 403 that is NOT a permission failure', async () => {
    // The mismatch that forced `code` onto ApiError: by status alone this
    // is `kind: 'forbidden'`, indistinguishable from every authorization
    // failure in the app, and LoginPage would show a generic error
    // instead of routing to the verify-email screen.
    fetchMock.mockImplementation(
      json(
        { message: 'Verify your email address before signing in', code: 'email_unverified' },
        403,
      ),
    );

    await expect(
      httpAuthService.login({ email: 'a@b.co', password: 'p', rememberMe: false }),
    ).rejects.toMatchObject({ code: 'email_unverified' });
  });

  it('maps a lockout 429 onto rate_limited', async () => {
    fetchMock.mockImplementation(
      json({ message: 'Too many failed attempts', code: 'rate_limited' }, 429),
    );

    await expect(
      httpAuthService.login({ email: 'a@b.co', password: 'p', rememberMe: false }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  // RM M39.1 — every code the server raises, at the status it raises it
  // with (`backend/src/modules/auth/services/*.ts`), round-trips from the
  // HTTP body to the coded `AuthError` the pages branch on. `otp_required`
  // is absent on purpose: the server sends it as a 200 challenge, never as
  // an error body (see "treats a 2FA challenge as a success" above). With a
  // refresh handler registered, none of them may spend a rotation (M39.4):
  // each is a business refusal, not an expired token.
  it.each([
    ['invalid_credentials', 401],
    ['otp_invalid', 401],
    ['token_invalid', 401],
    ['email_unverified', 403],
    ['account_inactive', 403],
    ['two_factor_required', 403],
    ['email_taken', 409],
    ['professional_number_taken', 409],
    ['token_invalid', 422],
    ['weak_password', 422],
    ['rate_limited', 429],
  ] as const)('round-trips %s from an HTTP %i body and spends no refresh', async (code, status) => {
    fetchMock.mockImplementation(json({ message: 'refused', code }, status));
    const refresh = vi.fn(() => Promise.resolve('fresh-token'));
    apiClient.setUnauthorizedHandler(refresh);

    const failure = await httpAuthService
      .login({ email: 'a@b.co', password: 'p', rememberMe: false })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(isAuthError(failure)).toBe(true);
    expect(failure).toMatchObject({ code });
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops permissions the frontend cannot render instead of refusing the sign-in', async () => {
    fetchMock.mockImplementation(
      json({
        data: {
          ...REAL_LOGIN_PAYLOAD.data,
          user: {
            ...REAL_LOGIN_PAYLOAD.data.user,
            permissions: ['patients.view', 'billing.refund', 'ai.use'],
          },
        },
      }),
    );

    const outcome = await httpAuthService.login({
      email: 'a@b.co',
      password: 'p',
      rememberMe: false,
    });

    if (outcome.kind !== 'session') throw new Error('expected a session');
    expect(outcome.session.user.permissions).toEqual(['patients.view', 'ai.use']);
  });

  it.each(['reception', 'laboratory', 'pharmacy'])(
    'accepts a %s account, which now has a workspace to land in (DEC-006a)',
    async (role) => {
      fetchMock.mockImplementation(
        json({
          data: {
            ...REAL_LOGIN_PAYLOAD.data,
            user: { ...REAL_LOGIN_PAYLOAD.data.user, role, permissions: ['patients.view'] },
          },
        }),
      );

      const outcome = await httpAuthService.login({
        email: 'a@b.co',
        password: 'p',
        rememberMe: false,
      });

      if (outcome.kind !== 'session') throw new Error('expected a session');
      expect(outcome.session.user.role).toBe(role);
    },
  );

  it('refuses a role it cannot route, rather than rendering an unplaceable session', async () => {
    fetchMock.mockImplementation(
      json({
        data: {
          ...REAL_LOGIN_PAYLOAD.data,
          user: { ...REAL_LOGIN_PAYLOAD.data.user, role: 'pharmacist' },
        },
      }),
    );

    await expect(
      httpAuthService.login({ email: 'a@b.co', password: 'p', rememberMe: false }),
    ).rejects.toSatisfy(isAuthError);
  });

  // DEC-013. A custom role (API §15.4) signs in on the server, but the
  // session does not say which base role it copies, so the client has no
  // workspace to put it in. It must say so — not "Incorrect email or
  // password" — and must not leave the server session it refused open.
  it('names an unsupported role and closes the session it refused', async () => {
    fetchMock.mockImplementation((input: URL) =>
      String(input).endsWith('/auth/logout')
        ? json(null, 204)()
        : json({
            data: {
              ...REAL_LOGIN_PAYLOAD.data,
              user: { ...REAL_LOGIN_PAYLOAD.data.user, role: 'senior_nurse' },
            },
          })(),
    );

    const refusal = httpAuthService.login({ email: 'a@b.co', password: 'p', rememberMe: false });

    await expect(refusal).rejects.toBeInstanceOf(UnsupportedRoleError);
    await expect(refusal).rejects.toMatchObject({ role: 'senior_nurse' });
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths.at(-1)).toMatch(/\/auth\/logout$/);
  });
});

describe('httpAuthService — an unsupported role on reload (DEC-013)', () => {
  it('refuses a restored session it cannot place, and signs it out', async () => {
    fetchMock.mockImplementation((input: URL) =>
      String(input).endsWith('/auth/logout')
        ? json(null, 204)()
        : json({
            data: {
              ...REAL_LOGIN_PAYLOAD.data,
              user: { ...REAL_LOGIN_PAYLOAD.data.user, role: 'senior_nurse' },
            },
          })(),
    );

    await expect(httpAuthService.restore()).rejects.toBeInstanceOf(UnsupportedRoleError);
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths[0]).toMatch(/\/auth\/refresh$/);
    expect(paths.at(-1)).toMatch(/\/auth\/logout$/);
  });
});

describe('httpAuthService — the step-up and verification flows', () => {
  it('completes a challenge with the otpToken, not just the code', async () => {
    fetchMock.mockImplementation(json(REAL_LOGIN_PAYLOAD));

    await httpAuthService.verifyOtp('123456', {
      email: 'a@b.co',
      rememberMe: false,
      otpToken: 'otp_handle_1',
    });

    expect(lastCall().url.pathname).toBe('/api/v1/auth/otp/verify');
    expect(lastCall().body).toEqual({ otpToken: 'otp_handle_1', code: '123456' });
  });

  it('completes a challenge with a recovery code on its own route (R1)', async () => {
    fetchMock.mockImplementation(json(REAL_LOGIN_PAYLOAD));

    const session = await httpAuthService.redeemRecoveryCode('  0A1B2-C3D4E ', {
      email: 'a@b.co',
      rememberMe: false,
      otpToken: 'otp_handle_1',
    });

    expect(lastCall().url.pathname).toBe('/api/v1/auth/otp/recovery');
    // Trimmed, otherwise as typed: the server owns the normalisation.
    expect(lastCall().body).toEqual({ otpToken: 'otp_handle_1', recoveryCode: '0A1B2-C3D4E' });
    expect(session?.user.email).toBe('seam.tester@medora.health');
  });

  it('maps a wrong recovery code to otp_invalid', async () => {
    fetchMock.mockImplementation(
      json({ message: 'That code is not valid', code: 'otp_invalid' }, 401),
    );

    await expect(
      httpAuthService.redeemRecoveryCode('nope', {
        email: 'a@b.co',
        rememberMe: false,
        otpToken: 'otp_handle_1',
      }),
    ).rejects.toMatchObject({ code: 'otp_invalid' });
  });

  it('refuses to redeem a recovery code with no challenge in progress', async () => {
    await expect(httpAuthService.redeemRecoveryCode('0a1b2-c3d4e', null)).rejects.toMatchObject({
      code: 'otp_invalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to verify an OTP with no challenge in progress', async () => {
    await expect(httpAuthService.verifyOtp('123456', null)).rejects.toMatchObject({
      code: 'otp_invalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns no session from verify-email — the backend does not sign you in', async () => {
    fetchMock.mockImplementation(json(null, 204));

    const session = await httpAuthService.verifyEmail('tok_abc', null);

    expect(session).toBeNull();
    expect(lastCall().body).toEqual({ token: 'tok_abc' });
  });

  it('maps a 422 token_invalid from verify-email', async () => {
    fetchMock.mockImplementation(
      json(
        { message: 'That link is no longer valid', code: 'token_invalid', fieldErrors: {} },
        422,
      ),
    );

    await expect(httpAuthService.verifyEmail('nope', null)).rejects.toMatchObject({
      code: 'token_invalid',
    });
  });

  it('resends a verification to the pending address, which the endpoint takes instead of a token', async () => {
    fetchMock.mockImplementation(json({ data: { accepted: true } }, 202));

    await httpAuthService.resendVerification({
      email: 'pending@medora.health',
      rememberMe: false,
      otpToken: null,
    });

    expect(lastCall().url.pathname).toBe('/api/v1/auth/verification/resend');
    expect(lastCall().body).toEqual({ email: 'pending@medora.health' });
  });

  it('reports a weak password from the reset endpoint as weak_password', async () => {
    fetchMock.mockImplementation(
      json(
        {
          message: 'Validation failed',
          code: 'weak_password',
          fieldErrors: { password: ['Add a symbol'] },
        },
        422,
      ),
    );

    await expect(httpAuthService.resetPassword('tok', 'weak')).rejects.toMatchObject({
      code: 'weak_password',
    });
  });

  it('sends the consent booleans the register DTO requires', async () => {
    fetchMock.mockImplementation(
      json({ data: { nextStep: 'verify-email', email: 'new@medora.health' } }, 201),
    );

    const result = await httpAuthService.register({
      firstName: 'Seam',
      lastName: 'Tester',
      email: 'new@medora.health',
      phone: '+15551239876',
      password: 'Medora123!',
      role: 'doctor',
      professionalRegistrationNumber: 'SEAM-4471',
      professionalCategory: 'physician',
      specialty: 'Cardiology',
      acceptTerms: true,
      acceptPrivacy: true,
    });

    expect(result).toEqual({ nextStep: 'verify-email', email: 'new@medora.health' });
    expect(lastCall().body).toMatchObject({ acceptTerms: true, acceptPrivacy: true });
  });

  it('sends the professional block on a doctor registration (ADR-035)', async () => {
    fetchMock.mockImplementation(
      json({ data: { nextStep: 'verify-email', email: 'doc@medora.health' } }, 201),
    );

    await httpAuthService.register({
      firstName: 'Amelia',
      lastName: 'Chen',
      email: 'doc@medora.health',
      phone: '+15551239876',
      password: 'Medora123!',
      role: 'doctor',
      professionalRegistrationNumber: 'SCFHS-99120',
      professionalCategory: 'physician',
      specialty: 'Cardiology',
      registrationExpiresOn: '2030-01-31',
      acceptTerms: true,
      acceptPrivacy: true,
    });

    expect(lastCall().body).toMatchObject({
      role: 'doctor',
      professionalRegistrationNumber: 'SCFHS-99120',
      professionalCategory: 'physician',
      specialty: 'Cardiology',
      registrationExpiresOn: '2030-01-31',
    });
    // The old optional field is gone from the wire shape entirely.
    expect(lastCall().body).not.toHaveProperty('licenseNumber');
  });

  it('omits an empty expiry rather than sending a blank string', async () => {
    fetchMock.mockImplementation(
      json({ data: { nextStep: 'verify-email', email: 'doc2@medora.health' } }, 201),
    );

    await httpAuthService.register({
      firstName: 'Amelia',
      lastName: 'Chen',
      email: 'doc2@medora.health',
      phone: '+15551239876',
      password: 'Medora123!',
      role: 'doctor',
      professionalRegistrationNumber: 'SCFHS-99121',
      professionalCategory: 'dentist',
      specialty: 'Orthodontics',
      registrationExpiresOn: '',
      acceptTerms: true,
      acceptPrivacy: true,
    });

    // The server's schema is `.optional()`, not "optional or blank" — a
    // date input yields '' when untouched, and '' fails its regex.
    expect(lastCall().body).not.toHaveProperty('registrationExpiresOn');
  });

  it('sends no professional block on a patient registration', async () => {
    fetchMock.mockImplementation(
      json({ data: { nextStep: 'verify-email', email: 'pt@medora.health' } }, 201),
    );

    await httpAuthService.register({
      firstName: 'Sara',
      lastName: 'Ali',
      email: 'pt@medora.health',
      phone: '+15551239876',
      password: 'Medora123!',
      role: 'patient',
      acceptTerms: true,
      acceptPrivacy: true,
    });

    expect(lastCall().body).toMatchObject({ role: 'patient' });
    for (const field of [
      'professionalRegistrationNumber',
      'professionalCategory',
      'specialty',
      'licenseNumber',
    ]) {
      expect(lastCall().body).not.toHaveProperty(field);
    }
  });

  it('maps 409 email_taken from register', async () => {
    fetchMock.mockImplementation(
      json({ message: 'Email already registered', code: 'email_taken', detail: 'exists' }, 409),
    );

    await expect(
      httpAuthService.register({
        firstName: 'A',
        lastName: 'B',
        email: 'taken@medora.health',
        phone: '+15551239876',
        password: 'Medora123!',
        role: 'doctor',
        professionalRegistrationNumber: 'SEAM-4472',
        professionalCategory: 'physician',
        specialty: 'Cardiology',
        acceptTerms: true,
        acceptPrivacy: true,
      }),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });
});

describe('httpAuthService.reauthenticate — the lock screen (A-12a)', () => {
  /** `POST /me/password/verify`'s refusals, as `AppException` serialises them. */
  const WRONG_PASSWORD = {
    message: 'Password is not correct',
    code: 'invalid_credentials',
  };

  function paths(): string[] {
    return fetchMock.mock.calls.map((call) => (call[0] as URL).pathname);
  }

  it('verifies the password for the held session and mints none', async () => {
    apiClient.setAccessToken('held-token');
    fetchMock.mockImplementation(json(null, 204));

    const session = await httpAuthService.reauthenticate('dr@medora.health', 'Right-horse-1');

    expect(session).toBeNull();
    expect(paths()).toEqual(['/api/v1/me/password/verify']);
    expect(lastCall().body).toEqual({ password: 'Right-horse-1' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer held-token');
  });

  it('names a wrong password and spends no refresh on its 401', async () => {
    const refresh = vi.fn(() => Promise.resolve('rotated'));
    apiClient.setUnauthorizedHandler(refresh);
    fetchMock.mockImplementation(json(WRONG_PASSWORD, 401));

    await expect(httpAuthService.reauthenticate('dr@medora.health', 'wrong')).rejects.toMatchObject(
      { code: 'invalid_credentials' },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('treats the lockout as the end of the session, because the server revoked it', async () => {
    apiClient.setAccessToken('held-token');
    fetchMock
      .mockImplementationOnce(
        json({ message: 'Too many failed attempts', code: 'rate_limited' }, 429),
      )
      .mockImplementation(json(REAL_LOGIN_PAYLOAD));

    const failure = httpAuthService.reauthenticate('dr@medora.health', 'wrong');

    await expect(failure).rejects.toBeInstanceOf(ReauthLockoutError);
    await expect(failure).rejects.toMatchObject({ code: 'rate_limited' });
    // The revoked session's token is not kept for a later request to carry.
    await apiClient.get('/me/account');
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('falls back to a real sign-in against an API that has no verify route (404)', async () => {
    fetchMock
      .mockImplementationOnce(json({ message: 'Cannot POST /api/v1/me/password/verify' }, 404))
      .mockImplementation(json(REAL_LOGIN_PAYLOAD));

    const session = await httpAuthService.reauthenticate('dr@medora.health', 'Right-horse-1');

    expect(paths()).toEqual(['/api/v1/me/password/verify', '/api/v1/auth/login']);
    expect(lastCall().body).toEqual({
      email: 'dr@medora.health',
      password: 'Right-horse-1',
      rememberMe: false,
    });
    expect(session?.user.email).toBe('seam.tester@medora.health');
  });

  it('keeps the fallback honest about a two-factor account it cannot complete', async () => {
    fetchMock
      .mockImplementationOnce(json({ message: 'Not Found' }, 404))
      .mockImplementation(json({ data: { requiresOtp: true, otpToken: 'otp_1' } }));

    await expect(
      httpAuthService.reauthenticate('dr@medora.health', 'Right-horse-1'),
    ).rejects.toMatchObject({ code: 'otp_required' });
  });
});
