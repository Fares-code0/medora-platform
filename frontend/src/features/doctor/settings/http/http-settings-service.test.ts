import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { CurrentPasswordError, SettingsConflictError } from '../model/settings-service';

import { httpSettingsService } from './http-settings-service';

/**
 * Account settings over HTTP (FE-10.9), against bodies captured from the
 * `/me/*` routes on a seeded database.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function documentRoutes(overrides: Record<string, () => Response | { data: unknown }> = {}) {
  return {
    'GET /me/account': () =>
      envelope({
        email: 'doctor@medora.health',
        username: null,
        phone: '+20 100 000 0000',
        passwordUpdatedAt: '2026-10-04T15:52:32.384Z',
        twoFactorEnabled: false,
        emailVerified: true,
      }),
    'GET /me/sessions': () =>
      envelope([
        {
          id: 'ses-1',
          device: null,
          browser: null,
          location: null,
          ipAddress: '127.0.0.1',
          startedAt: '2026-10-04T18:42:39.789Z',
          lastActiveAt: '2026-10-04T18:42:39.789Z',
          current: true,
        },
      ]),
    'GET /me/devices': () =>
      envelope([
        {
          id: 'dev-1',
          name: 'Work laptop',
          platform: 'desktop',
          addedAt: '2026-10-01T09:00:00.000Z',
          lastSeenAt: null,
          current: false,
        },
      ]),
    'GET /me/login-history': () =>
      pageOf([
        {
          id: 'log-1',
          at: '2026-10-04T18:42:39.793Z',
          device: null,
          location: null,
          ipAddress: '127.0.0.1',
          status: 'success',
        },
      ]),
    'GET /me/activity': () =>
      pageOf([
        {
          id: 'act-1',
          at: '2026-10-04T18:27:19.921Z',
          kind: 'profile',
          summary: 'Reviewed a critical lab result',
          detail: 'LAB-100000',
        },
      ]),
    // What an API built from `main` answers: the Settings Center (RM M22)
    // is served only by `backend`.
    'GET /me/settings': () => json({ message: 'Cannot GET', code: 'not_found' }, 404),
    ...overrides,
  };
}

/** `GET /me/settings` as `backend`'s `SettingsService.read` builds it. */
function settingsCenter(updatedAt = '2026-10-20T08:00:00.000Z') {
  return envelope({
    updatedAt,
    privacy: { dataSharing: false, analytics: true, cookies: true, aiDataUsage: false },
    workflow: {
      landingPage: 'overview',
      defaultPatientTab: 'summary',
      defaultRecordsTab: 'all',
      autoSaveDrafts: true,
      dateFormat: 'MM/DD/YYYY',
      timeFormat: '12h',
      timezone: 'UTC',
    },
    appearance: { theme: 'system', locale: 'en', density: 'comfortable', sidebarCollapsed: false },
    accessibility: {
      textScale: 100,
      reduceMotion: false,
      highContrast: false,
      focusRings: 'default',
      keyboardNav: false,
    },
    integrations: [
      {
        id: 'google-calendar',
        connected: true,
        connectedAt: '2026-10-01T09:00:00.000Z',
        account: 'a.chen@gmail.com',
      },
      { id: 'outlook', connected: false, connectedAt: null, account: null },
      { id: 'zoom', connected: false, connectedAt: null, account: null },
      { id: 'teams', connected: false, connectedAt: null, account: null },
    ],
    activity: [],
  });
}

const PRIVACY = { dataSharing: true, analytics: false, cookies: true, aiDataUsage: false };

describe('fetchSettings', () => {
  it('composes the document from the server, and writes none of it into the browser', async () => {
    stubApi(documentRoutes());

    const document = await httpSettingsService.fetchSettings('usr-1');

    expect(document.account).toMatchObject({ email: 'doctor@medora.health', username: '' });
    expect(document.security).toMatchObject({
      twoFactorEnabled: false,
      activeSessions: [{ id: 'ses-1', device: 'Unknown device', current: true }],
      trustedDevices: [
        { id: 'dev-1', platform: 'desktop', lastSeenAt: '2026-10-01T09:00:00.000Z' },
      ],
      loginHistory: [{ id: 'log-1', status: 'success' }],
    });
    expect(document.activity[0]).toMatchObject({ summary: 'Reviewed a critical lab result' });
    expect(document.integrations.every((integration) => !integration.connected)).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it('is an error, not a seeded document, when the server fails', async () => {
    stubApi(documentRoutes({ 'GET /me/sessions': () => json({ message: 'Internal' }, 500) }));
    await expect(httpSettingsService.fetchSettings('usr-1')).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('writes', () => {
  it('saves username and phone — the email is not the doctor’s to change here', async () => {
    const { requests } = stubApi({
      ...documentRoutes(),
      'PATCH /me/account': () => envelope({}),
    });

    await httpSettingsService.saveAccount('usr-1', {
      email: 'other@example.com',
      username: ' amelia ',
      phone: '+20 100 000 0001',
    });

    expect(requests.find((request) => request.method === 'PATCH')?.body).toEqual({
      username: 'amelia',
      phone: '+20 100 000 0001',
    });
  });

  it('turns a wrong current password into the form’s own error', async () => {
    stubApi({
      'POST /me/password': () =>
        json({ message: 'Unauthorized', code: 'invalid_credentials' }, 401),
    });
    await expect(
      httpSettingsService.changePassword('usr-1', { current: 'wrong', next: 'Medora456!' }),
    ).rejects.toBeInstanceOf(CurrentPasswordError);
  });

  it('enrols two-factor in the server’s steps: setup, then a code', async () => {
    const { requests } = stubApi({
      ...documentRoutes(),
      'POST /me/2fa/setup': () =>
        envelope({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl: 'otpauth://totp/Medora:doctor?secret=JBSWY3DPEHPK3PXP',
          recoveryCodes: ['aaaa-bbbb'],
        }),
      'POST /me/2fa/enable': () => new Response(null, { status: 204 }),
    });

    const enrolment = await httpSettingsService.beginTwoFactorSetup('usr-1', 'my password');
    await httpSettingsService.enableTwoFactor('usr-1', '123456');

    expect(enrolment.secret).toBe('JBSWY3DPEHPK3PXP');
    // Owner decision D2: the current password goes with the setup call.
    expect(requests.find((request) => request.path === '/me/2fa/setup')?.body).toEqual({
      password: 'my password',
    });
    expect(requests.find((request) => request.path === '/me/2fa/enable')?.body).toEqual({
      code: '123456',
    });
  });

  it('refuses what no route keeps, sending nothing', async () => {
    const { requests } = stubApi({});
    await expect(
      httpSettingsService.updateSecurity('usr-1', { twoFactorEnabled: true }),
    ).rejects.toMatchObject({ code: 'not_connected' });
    // Never read from a server that keeps it: there is no version to send.
    await expect(
      httpSettingsService.updatePrivacy('usr-never-read', PRIVACY),
    ).rejects.toMatchObject({ code: 'not_connected' });
    expect(requests).toHaveLength(0);
  });

  it('revokes a session and answers the refetched document', async () => {
    const { requests } = stubApi({
      ...documentRoutes(),
      'DELETE /me/sessions/ses-2': () => new Response(null, { status: 204 }),
    });
    await httpSettingsService.revokeSession('usr-1', 'ses-2');
    expect(requests.map((request) => `${request.method} ${request.path}`)).toContain(
      'DELETE /me/sessions/ses-2',
    );
    expect(requests.filter((request) => request.path === '/me/account')).toHaveLength(1);
  });
});

describe('the Settings Center (RM M22, `backend` only)', () => {
  it('reads privacy and integrations from the server when it keeps them', async () => {
    stubApi(documentRoutes({ 'GET /me/settings': () => settingsCenter() }));

    const document = await httpSettingsService.fetchSettings('usr-m22');

    expect(document.settingsCenter).toBe('served');
    expect(document.privacy).toEqual({
      dataSharing: false,
      analytics: true,
      cookies: true,
      aiDataUsage: false,
    });
    expect(document.integrations).toEqual([
      {
        id: 'google-calendar',
        connected: true,
        connectedAt: '2026-10-01T09:00:00.000Z',
        account: 'a.chen@gmail.com',
      },
      { id: 'outlook', connected: false, connectedAt: null, account: null },
      { id: 'zoom', connected: false, connectedAt: null, account: null },
      { id: 'teams', connected: false, connectedAt: null, account: null },
    ]);
  });

  it('reads a 404 as a server that does not keep them, and the rest of the document loads', async () => {
    stubApi(documentRoutes());

    const document = await httpSettingsService.fetchSettings('usr-main');

    expect(document.settingsCenter).toBe('unserved');
    expect(document.account.email).toBe('doctor@medora.health');
  });

  it('reads any other failure as a failure of those two sections alone', async () => {
    stubApi(documentRoutes({ 'GET /me/settings': () => json({ message: 'boom' }, 500) }));

    const document = await httpSettingsService.fetchSettings('usr-500');

    expect(document.settingsCenter).toBe('failed');
    expect(document.security.activeSessions).toHaveLength(1);
  });

  it('treats a body it cannot read as failed, never as consents', async () => {
    stubApi(
      documentRoutes({
        'GET /me/settings': () =>
          envelope({ updatedAt: '2026-10-20T08:00:00.000Z', privacy: {}, integrations: [] }),
      }),
    );

    expect((await httpSettingsService.fetchSettings('usr-bad')).settingsCenter).toBe('failed');
  });

  it('writes the privacy slice whole, with the version it read, then answers the refetched document', async () => {
    const { requests } = stubApi(
      documentRoutes({
        'GET /me/settings': () => settingsCenter(),
        'PATCH /me/settings/privacy': () => settingsCenter('2026-10-25T10:00:00.000Z'),
      }),
    );
    await httpSettingsService.fetchSettings('usr-write');

    await httpSettingsService.updatePrivacy('usr-write', PRIVACY);

    const patch = requests.find((request) => request.method === 'PATCH');
    expect(patch?.path).toBe('/me/settings/privacy');
    expect(patch?.body).toEqual({ updatedAt: '2026-10-20T08:00:00.000Z', value: PRIVACY });
    // Refetched after the write, so the activity the server recorded shows.
    expect(requests.filter((request) => request.path === '/me/settings')).toHaveLength(2);
  });

  it('sends the version of the latest read, not the first', async () => {
    let version = '2026-10-20T08:00:00.000Z';
    const { requests } = stubApi(
      documentRoutes({
        'GET /me/settings': () => settingsCenter(version),
        'PATCH /me/settings/privacy': () => settingsCenter(),
      }),
    );
    await httpSettingsService.fetchSettings('usr-reread');
    version = '2026-10-22T08:00:00.000Z';
    await httpSettingsService.fetchSettings('usr-reread');

    await httpSettingsService.updatePrivacy('usr-reread', PRIVACY);

    expect(requests.find((request) => request.method === 'PATCH')?.body).toMatchObject({
      updatedAt: '2026-10-22T08:00:00.000Z',
    });
  });

  it('turns a 409 into a conflict the section can name', async () => {
    stubApi(
      documentRoutes({
        'GET /me/settings': () => settingsCenter(),
        'PATCH /me/settings/privacy': () =>
          json({ message: 'These settings changed since you loaded them.', code: 'conflict' }, 409),
      }),
    );
    await httpSettingsService.fetchSettings('usr-409');

    await expect(httpSettingsService.updatePrivacy('usr-409', PRIVACY)).rejects.toBeInstanceOf(
      SettingsConflictError,
    );
  });

  it('disconnects through the server and answers the refetched document', async () => {
    const { requests } = stubApi(
      documentRoutes({
        'GET /me/settings': () => settingsCenter(),
        'POST /me/integrations/google-calendar/disconnect': () => settingsCenter(),
      }),
    );

    await httpSettingsService.toggleIntegration('usr-1', {
      id: 'google-calendar',
      connect: false,
      account: null,
    });

    expect(requests.map((request) => `${request.method} ${request.path}`)).toContain(
      'POST /me/integrations/google-calendar/disconnect',
    );
  });

  it("answers a connect with the server's own refusal", async () => {
    stubApi(
      documentRoutes({
        'POST /me/integrations/zoom/connect': () =>
          json({ message: 'needs an OAuth client', code: 'not_implemented' }, 501),
      }),
    );

    await expect(
      httpSettingsService.toggleIntegration('usr-1', { id: 'zoom', connect: true, account: 'x' }),
    ).rejects.toMatchObject({ kind: 'server' });
  });

  it('offers neither Connect nor account deletion live', () => {
    expect(httpSettingsService.capabilities).toMatchObject({
      integrationConnect: false,
      accountDeletion: false,
    });
  });
});

describe('two-factor status and re-enrolment (owner decisions R2, Q7 / R4)', () => {
  it('reads the remaining recovery codes from GET /me/2fa, the only place they are served', async () => {
    stubApi({
      ...documentRoutes(),
      'GET /me/2fa': () => envelope({ enabled: true, recoveryCodesRemaining: 3 }),
    });

    const document = await httpSettingsService.fetchSettings('usr-1');

    expect(document.security.recoveryCodesRemaining).toBe(3);
  });

  it('does not know the count against an API without the route, and still loads the page', async () => {
    stubApi({
      ...documentRoutes(),
      'GET /me/2fa': () => json({ message: 'Cannot GET', code: 'not_found' }, 404),
    });

    const document = await httpSettingsService.fetchSettings('usr-1');

    expect(document.security.recoveryCodesRemaining).toBeNull();
    expect(document.account.email).toBe('doctor@medora.health');
  });

  it('treats a failed or malformed status read as unknown, never as zero', async () => {
    stubApi({
      ...documentRoutes(),
      'GET /me/2fa': () => envelope({ enabled: true, recoveryCodesRemaining: '3' }),
    });
    expect((await httpSettingsService.fetchSettings('usr-1')).security.recoveryCodesRemaining).toBe(
      null,
    );

    stubApi({
      ...documentRoutes(),
      'GET /me/2fa': () => json({ message: 'Boom', code: 'internal' }, 500),
    });
    expect((await httpSettingsService.fetchSettings('usr-1')).security.recoveryCodesRemaining).toBe(
      null,
    );
  });

  it('starts with the password and the current code, then confirms with the new code', async () => {
    const { requests } = stubApi({
      'POST /me/2fa/reenroll': () =>
        envelope({
          otpauthUrl: 'otpauth://totp/Medora:doctor?secret=NEWSECRETNEWSECR',
          secret: 'NEWSECRETNEWSECR',
          enrolmentToken: 'enrol.jwt.token',
        }),
      'POST /me/2fa/reenroll/confirm': () =>
        envelope({ recoveryCodes: ['0a1b2-c3d4e', '5f6a7-b8c9d'] }),
    });

    const started = await httpSettingsService.beginTwoFactorReenrollment('usr-1', {
      password: 'Medora123!',
      code: '111111',
    });
    const codes = await httpSettingsService.confirmTwoFactorReenrollment('usr-1', {
      enrolmentToken: started.enrolmentToken,
      code: '222222',
    });

    expect(started).toEqual({
      otpauthUrl: 'otpauth://totp/Medora:doctor?secret=NEWSECRETNEWSECR',
      secret: 'NEWSECRETNEWSECR',
      enrolmentToken: 'enrol.jwt.token',
    });
    expect(codes).toEqual(['0a1b2-c3d4e', '5f6a7-b8c9d']);
    expect(requests.map((request) => [request.path, request.body])).toEqual([
      ['/me/2fa/reenroll', { password: 'Medora123!', code: '111111' }],
      ['/me/2fa/reenroll/confirm', { enrolmentToken: 'enrol.jwt.token', code: '222222' }],
    ]);
  });

  it('passes a refusal through with its code, for the dialog to name', async () => {
    stubApi({
      'POST /me/2fa/reenroll': () =>
        json({ message: 'That code is not valid', code: 'otp_invalid' }, 401),
    });

    await expect(
      httpSettingsService.beginTwoFactorReenrollment('usr-1', {
        password: 'Medora123!',
        code: '000000',
      }),
    ).rejects.toMatchObject({ code: 'otp_invalid' });
  });
});
