import { ResponseContractError } from '@/schemas/envelope';

import { httpAuthService } from './http-auth-service';
import type { RegisterInput } from './model/types';

/**
 * The live auth adapter — checklist D-01, D-06…D-12, V-02.
 *
 * Every other live adapter in this tree has one of these
 * (`http-doctor-service.test.ts`, `http-appointment-service.test.ts`,
 * `http-notification-service.test.ts`, `http-profile-service.test.ts`).
 * Auth did not, and it sat at 9.1% statements — the most
 * security-critical mapping in the client and the only one nothing
 * checked.
 *
 * `global.fetch` is stubbed rather than `apiClient`, the same way the
 * other four do it, so these tests run through the real transport: the
 * headers, the envelope unwrapping and the schema all participate. A
 * mocked `apiClient` would assert the adapter agrees with itself.
 */

function stubFetch(responses: readonly Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(response as Response);
  });
  return {
    calls,
    /** The JSON body of the nth request, as the server would parse it. */
    body: (n = 0) => JSON.parse(String(calls[n]?.init.body ?? '{}')) as Record<string, unknown>,
    header: (name: string, n = 0) =>
      (calls[n]?.init.headers as Record<string, string> | undefined)?.[name],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

const SESSION = {
  data: {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: {
      id: 'usr_1',
      email: 'amina.yusuf@example.com',
      firstName: 'Amina',
      lastName: 'Yusuf',
      emailVerified: true,
    },
  },
};

const REGISTRATION: RegisterInput = {
  firstName: 'Amina',
  lastName: 'Yusuf',
  email: 'amina.yusuf@example.com',
  phone: '+962790000000',
  password: 'NewPassword2@',
  acceptTerms: true,
  acceptPrivacy: true,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the transport contract (ADR-034)', () => {
  it('identifies itself as a mobile client on every call, which is what puts the refresh token in the body', async () => {
    const fetchStub = stubFetch([json(200, SESSION)]);

    await httpAuthService.refresh('refresh-0');

    // A web client gets a Set-Cookie here and no body field. This header
    // is the whole reason the mobile path exists, and it is set
    // unconditionally by `ApiClient` rather than per call.
    expect(fetchStub.header('X-Client-Type')).toBe('mobile');
  });

  it('sends the refresh token in the body and reads the new pair back out of it', async () => {
    const fetchStub = stubFetch([json(200, SESSION)]);

    const result = await httpAuthService.refresh('refresh-0');

    expect(fetchStub.calls[0]?.url).toContain('auth/refresh');
    expect(fetchStub.body()).toEqual({ refreshToken: 'refresh-0' });
    expect(result.tokens).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  });
});

describe('signing in', () => {
  it('returns a session when the server answers with one', async () => {
    stubFetch([json(200, SESSION)]);

    const outcome = await httpAuthService.login({
      email: 'amina.yusuf@example.com',
      password: 'x',
      rememberMe: false,
    });

    expect(outcome.kind).toBe('authenticated');
  });

  it('returns a step-up when the server answers with a challenge instead', async () => {
    // Same route, same status, two shapes. The discriminator is the
    // presence of `otpToken`, not the status code.
    stubFetch([json(200, { data: { otpToken: 'OTP-1' } })]);

    const outcome = await httpAuthService.login({
      email: 'amina.yusuf@example.com',
      password: 'x',
      rememberMe: false,
    });

    expect(outcome).toEqual({ kind: 'otp-required', otpToken: 'OTP-1' });
  });

  it('sends the OTP token back with the code, and gets a session for it', async () => {
    const fetchStub = stubFetch([json(200, SESSION)]);

    const result = await httpAuthService.verifyOtp({ otpToken: 'OTP-1', code: '123456' });

    expect(fetchStub.body()).toEqual({ otpToken: 'OTP-1', code: '123456' });
    expect(result.identity.subjectId).toBe('usr_1');
  });

  it('resends a code against the token rather than the address', async () => {
    const fetchStub = stubFetch([noContent()]);

    await httpAuthService.resendOtp('OTP-1');

    expect(fetchStub.calls[0]?.url).toContain('auth/otp/resend');
    expect(fetchStub.body()).toEqual({ otpToken: 'OTP-1' });
  });
});

describe('the identity mapping', () => {
  it('joins the name when the server sends one', async () => {
    stubFetch([json(200, SESSION)]);

    const result = await httpAuthService.refresh('r');

    expect(result.identity.displayName).toBe('Amina Yusuf');
  });

  it("reads the backend's own `name` field (SessionUserPayload: id, name, email, role, permissions)", async () => {
    stubFetch([
      json(200, {
        data: {
          ...SESSION.data,
          user: {
            id: 'usr_3',
            name: 'Amina Yusuf',
            email: 'amina.yusuf@example.com',
            role: 'patient',
            permissions: [],
          },
        },
      }),
    ]);

    expect((await httpAuthService.refresh('r')).identity.displayName).toBe('Amina Yusuf');
  });

  it('falls back to the local part of the email rather than rendering "undefined undefined"', async () => {
    // The shape of a patient principal was AD-1's to decide and the name
    // fields are optional for that reason. A greeting is not worth a
    // crash, and it is certainly not worth the word "undefined".
    stubFetch([
      json(200, {
        data: { ...SESSION.data, user: { id: 'usr_2', email: 'amina.yusuf@example.com' } },
      }),
    ]);

    const result = await httpAuthService.refresh('r');

    expect(result.identity.displayName).toBe('amina.yusuf');
    expect(result.identity.displayName).not.toMatch(/undefined/);
  });

  it('uses whichever half of the name it was given', async () => {
    stubFetch([
      json(200, {
        data: { ...SESSION.data, user: { id: 'u', email: 'a@b.c', lastName: 'Yusuf' } },
      }),
    ]);

    expect((await httpAuthService.refresh('r')).identity.displayName).toBe('Yusuf');
  });

  it('treats a missing `emailVerified` as unverified, which is the safe reading', async () => {
    stubFetch([
      json(200, {
        data: { ...SESSION.data, user: { id: 'u', email: 'a@b.c', firstName: 'A' } },
      }),
    ]);

    expect((await httpAuthService.refresh('r')).identity.emailVerified).toBe(false);
  });
});

describe('registration (ADR-030 §4, ADR-035 §4)', () => {
  it('sends `role: patient` as a constant', async () => {
    const fetchStub = stubFetch([
      json(201, { data: { nextStep: 'verify-email', email: REGISTRATION.email } }),
    ]);

    await httpAuthService.register(REGISTRATION);

    expect(fetchStub.body().role).toBe('patient');
  });

  it('cannot be talked into asking for another role', async () => {
    // The role is not a parameter. A modified client asking for a
    // clinician account would be refused by the server, but it should not
    // be able to ask: the adapter forwards named account fields only.
    const fetchStub = stubFetch([
      json(201, { data: { nextStep: 'verify-email', email: REGISTRATION.email } }),
    ]);

    await httpAuthService.register({
      ...REGISTRATION,
      role: 'admin',
    } as RegisterInput & { role: string });

    expect(fetchStub.body().role).toBe('patient');
  });

  it('sends nothing clinical and no licence number', async () => {
    const fetchStub = stubFetch([
      json(201, { data: { nextStep: 'verify-email', email: REGISTRATION.email } }),
    ]);

    await httpAuthService.register(REGISTRATION);

    expect(Object.keys(fetchStub.body()).sort()).toEqual([
      'acceptPrivacy',
      'acceptTerms',
      'email',
      'firstName',
      'lastName',
      'password',
      'phone',
      'role',
    ]);
  });

  it('never carries the confirmation password onto the wire', async () => {
    const fetchStub = stubFetch([
      json(201, { data: { nextStep: 'verify-email', email: REGISTRATION.email } }),
    ]);

    await httpAuthService.register({
      ...REGISTRATION,
      confirmPassword: REGISTRATION.password,
    } as RegisterInput & { confirmPassword: string });

    expect(fetchStub.body()).not.toHaveProperty('confirmPassword');
  });

  it('returns no session — the account exists and cannot sign in yet', async () => {
    stubFetch([json(201, { data: { nextStep: 'verify-email', email: REGISTRATION.email } })]);

    const result = await httpAuthService.register(REGISTRATION);

    expect(result).toEqual({ nextStep: 'verify-email', email: REGISTRATION.email });
    expect(result).not.toHaveProperty('tokens');
  });

  it('fails loudly if the server ever answers a different next step', async () => {
    // `nextStep` is a literal, not a bare string, because it is what the
    // caller branches on to route. A backend that started answering
    // something else should stop here rather than route nowhere.
    stubFetch([json(201, { data: { nextStep: 'set-password', email: REGISTRATION.email } })]);

    await expect(httpAuthService.register(REGISTRATION)).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });
});

describe('the schemas hold the seam (V-02)', () => {
  it('fails loudly when a field this client reads disappears', async () => {
    // The alternative is `undefined` arriving three components deep, as a
    // blank name on a screen nobody can explain.
    stubFetch([
      json(200, { data: { accessToken: 'a', refreshToken: 'r', user: { email: 'a@b.c' } } }),
    ]);

    await expect(httpAuthService.refresh('r')).rejects.toBeInstanceOf(ResponseContractError);
  });

  it('names the route it was parsing, so a contract break is one line to diagnose', async () => {
    stubFetch([json(200, { data: { accessToken: 'a' } })]);

    await expect(httpAuthService.refresh('r')).rejects.toThrow(/auth\/refresh/);
  });

  it('ignores a field the backend adds, so a server release does not break the app', async () => {
    stubFetch([
      json(200, {
        data: {
          ...SESSION.data,
          somethingNew: { added: 'in a later release' },
          user: { ...SESSION.data.user, mfaEnrolled: true },
        },
      }),
    ]);

    await expect(httpAuthService.refresh('r')).resolves.toMatchObject({
      identity: { displayName: 'Amina Yusuf' },
    });
  });
});

describe('the routes with nothing to map', () => {
  it.each([
    ['logout', 'auth/logout', () => httpAuthService.logout()],
    [
      'resetPassword',
      'auth/reset-password',
      () => httpAuthService.resetPassword({ token: 't', password: 'NewPassword2@' }),
    ],
    ['verifyEmail', 'auth/verify-email', () => httpAuthService.verifyEmail('t')],
  ])('%s resolves on a 204 and calls %s', async (_name, path, call) => {
    const fetchStub = stubFetch([noContent()]);

    await expect(call()).resolves.toBeUndefined();
    expect(fetchStub.calls[0]?.url).toContain(path);
  });

  it.each([
    [
      'forgotPassword',
      'auth/forgot-password',
      () => httpAuthService.forgotPassword('nobody@example.com'),
    ],
    [
      'resendVerification',
      'auth/verification/resend',
      () => httpAuthService.resendVerification('nobody@example.com'),
    ],
  ])(
    '%s takes the 202 as a success and reads nothing out of it (%s)',
    async (_name, path, call) => {
      // Both routes answer **202 `{ accepted: true }`** for a real address,
      // an unknown one, a deactivated account and one still in cooldown.
      // The client must not distinguish those, and the way it does not is by
      // reading nothing at all out of the body.
      const fetchStub = stubFetch([json(202, { accepted: true })]);

      await expect(call()).resolves.toBeUndefined();
      expect(fetchStub.calls[0]?.url).toContain(path);
    },
  );

  it('asks to forget a password by address, and sends nothing else', async () => {
    const fetchStub = stubFetch([json(202, { accepted: true })]);

    await httpAuthService.forgotPassword('nobody@example.com');

    expect(fetchStub.body()).toEqual({ email: 'nobody@example.com' });
  });
});

describe('the account routes this adapter also serves (P-05, D-16)', () => {
  it('changes a password without ever putting one in the URL', async () => {
    const fetchStub = stubFetch([noContent()]);

    await httpAuthService.changePassword({
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword2@',
    });

    expect(fetchStub.calls[0]?.url).toContain('me/password');
    expect(fetchStub.calls[0]?.url).not.toMatch(/Password/);
    expect(fetchStub.body()).toEqual({
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword2@',
    });
  });

  it('returns the enrolment secret and its otpauth link, and no QR dependency', async () => {
    const fetchStub = stubFetch([
      json(200, {
        data: {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl: 'otpauth://totp/Medora:amina?secret=JBSWY3DPEHPK3PXP',
          recoveryCodes: ['aaaa-bbbb'],
        },
      }),
    ]);

    const setup = await httpAuthService.setupTwoFactor('OldPassword1!');

    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.recoveryCodes).toEqual(['aaaa-bbbb']);
    // Owner decision D2: the current password goes with the setup call.
    expect(fetchStub.calls[0]?.url).toContain('me/2fa/setup');
    expect(fetchStub.body()).toEqual({ password: 'OldPassword1!' });
  });

  it('enables with the code alone', async () => {
    const fetchStub = stubFetch([noContent()]);

    await httpAuthService.enableTwoFactor('123456');

    expect(fetchStub.calls[0]?.url).toContain('me/2fa/enable');
    expect(fetchStub.body()).toEqual({ code: '123456' });
  });

  it('requires the password to disable, because turning a control off is the step that needs re-auth', async () => {
    const fetchStub = stubFetch([noContent()]);

    await httpAuthService.disableTwoFactor('OldPassword1!');

    expect(fetchStub.calls[0]?.url).toContain('me/2fa/disable');
    expect(fetchStub.body()).toEqual({ password: 'OldPassword1!' });
  });
});

describe('recovery codes and re-enrolment (owner decisions R1, R2, Q7 / R4)', () => {
  it('completes a step-up with a recovery code on its own route, trimmed', async () => {
    const fetch = stubFetch([json(200, SESSION)]);

    const result = await httpAuthService.redeemRecoveryCode({
      otpToken: 'otp-1',
      recoveryCode: '  0A1B2-C3D4E ',
    });

    expect(fetch.calls[0]?.url).toMatch(/\/auth\/otp\/recovery$/);
    expect(fetch.body()).toEqual({ otpToken: 'otp-1', recoveryCode: '0A1B2-C3D4E' });
    // Token-in-body, exactly as `otp/verify` answers this client.
    expect(result.tokens.refreshToken).toBe('refresh-1');
  });

  it('passes a wrong recovery code through with its code', async () => {
    stubFetch([json(401, { message: 'That code is not valid', code: 'otp_invalid' })]);

    await expect(
      httpAuthService.redeemRecoveryCode({ otpToken: 'otp-1', recoveryCode: 'nope' }),
    ).rejects.toMatchObject({ code: 'otp_invalid' });
  });

  it('reads the 2FA status and the remaining recovery codes', async () => {
    const fetch = stubFetch([json(200, { data: { enabled: true, recoveryCodesRemaining: 4 } })]);

    await expect(httpAuthService.twoFactorStatus()).resolves.toEqual({
      enabled: true,
      recoveryCodesRemaining: 4,
    });
    expect(fetch.calls[0]?.url).toMatch(/\/me\/2fa$/);
    expect(fetch.calls[0]?.init.method).toBe('GET');
  });

  it('does not know the status against an API without the route (404)', async () => {
    stubFetch([json(404, { message: 'Cannot GET /api/v1/me/2fa', code: 'not_found' })]);

    await expect(httpAuthService.twoFactorStatus()).resolves.toBeNull();
  });

  it('keeps any other failed status read a failure, never "off"', async () => {
    stubFetch([json(500, { message: 'Boom', code: 'internal' })]);

    await expect(httpAuthService.twoFactorStatus()).rejects.toBeTruthy();
  });

  it('re-enrols with the password and the current code, then the new code', async () => {
    const fetch = stubFetch([
      json(200, {
        data: {
          secret: 'NEWSECRETNEWSECR',
          otpauthUrl: 'otpauth://totp/Medora:x?secret=NEWSECRETNEWSECR',
          enrolmentToken: 'enrol-1',
        },
      }),
      json(200, { data: { recoveryCodes: ['0a1b2-c3d4e', '5f6a7-b8c9d'] } }),
    ]);

    const started = await httpAuthService.startTwoFactorReenrollment({
      password: 'Password1!',
      code: '111111',
    });
    const codes = await httpAuthService.confirmTwoFactorReenrollment({
      enrolmentToken: started.enrolmentToken,
      code: '222222',
    });

    expect(fetch.calls[0]?.url).toMatch(/\/me\/2fa\/reenroll$/);
    expect(fetch.body(0)).toEqual({ password: 'Password1!', code: '111111' });
    expect(fetch.calls[1]?.url).toMatch(/\/me\/2fa\/reenroll\/confirm$/);
    expect(fetch.body(1)).toEqual({ enrolmentToken: 'enrol-1', code: '222222' });
    expect(codes).toEqual(['0a1b2-c3d4e', '5f6a7-b8c9d']);
  });
});
