import { fixtureAuthService } from '../fixtures/fixture-auth-service';
import { httpAuthService } from '../http-auth-service';
import type { AuthService } from '../model/types';

import {
  DEMO_PATIENT_REFRESH_TOKEN,
  DEMO_PATIENT_SESSION,
  isDemoRefreshToken,
  withDemoAccess,
} from './demo-session';

/**
 * The development demo patient.
 *
 * Two halves, and the second is the one that matters.
 *
 * 1. **It works in development.** `withDemoAccess` restores the demo
 *    session from the token the keychain holds, so a "Continue as Demo
 *    Patient" session survives an app restart.
 * 2. **It cannot work in production.** A release build never applies
 *    `withDemoAccess` — `service.ts` gates it on `__DEV__`, which Metro
 *    substitutes with `false` — so what a release build runs is the bare
 *    selection. The assertions below are made against exactly that object:
 *    the demo token reaches an adapter that does not know it, and is
 *    refused. This is asserted rather than argued because Metro does not
 *    tree-shake by module, so the fixture's *bytes* may ship even though
 *    nothing can execute them; "no code path honours this token" is the
 *    guarantee that survives that, and it is checkable here.
 */

describe('the demo refresh token', () => {
  it('is recognised only as itself', () => {
    expect(isDemoRefreshToken(DEMO_PATIENT_REFRESH_TOKEN)).toBe(true);
    expect(isDemoRefreshToken('fixture-refresh-sara@example.com')).toBe(false);
    expect(isDemoRefreshToken('')).toBe(false);
    // Not a prefix or substring match — a real token that merely started
    // with the same characters must not be mistaken for the fixture.
    expect(isDemoRefreshToken(`${DEMO_PATIENT_REFRESH_TOKEN}-other`)).toBe(false);
  });

  it('does not look like a credential, so nothing treats it as one', () => {
    expect(DEMO_PATIENT_REFRESH_TOKEN.startsWith('dev-demo-')).toBe(true);
    // Three dot-separated segments would make it JWT-shaped.
    expect(DEMO_PATIENT_REFRESH_TOKEN.split('.')).toHaveLength(1);
  });
});

describe('the demo patient identity', () => {
  it('is a patient with no permissions, matching the port', () => {
    // `model/types.ts` keeps `AuthenticatedIdentity` minimal on purpose:
    // the client makes no per-action authorization decision. The one
    // field beyond the minimum is `role`, which the C-11 eligibility gate
    // requires to be `patient` — without it the demo session would be
    // refused as ineligible.
    expect(Object.keys(DEMO_PATIENT_SESSION.identity).sort()).toEqual([
      'displayName',
      'email',
      'emailVerified',
      'role',
      'subjectId',
    ]);
    expect(DEMO_PATIENT_SESSION.identity.role).toBe('patient');
    expect(DEMO_PATIENT_SESSION.identity.displayName).toBe('Demo Patient');
    expect(DEMO_PATIENT_SESSION.identity.email).toContain('@medora.local');
  });
});

describe('withDemoAccess, which development uses', () => {
  it('restores the demo session from the demo token', async () => {
    const inner = { refresh: jest.fn() } as unknown as AuthService;

    await expect(withDemoAccess(inner).refresh(DEMO_PATIENT_REFRESH_TOKEN)).resolves.toEqual(
      DEMO_PATIENT_SESSION,
    );
    expect(inner.refresh).not.toHaveBeenCalled();
  });

  it('delegates every other token untouched', async () => {
    const real = { tokens: { accessToken: 'a', refreshToken: 'r' }, identity: {} };
    const inner = { refresh: jest.fn(() => Promise.resolve(real)) } as unknown as AuthService;

    await expect(withDemoAccess(inner).refresh('someone-elses-token')).resolves.toBe(real);
    expect(inner.refresh).toHaveBeenCalledWith('someone-elses-token');
  });

  it('leaves login alone, so no email and no password signs anyone in as the demo patient', async () => {
    // The demo session is reachable only by pressing the button. If
    // `login` were intercepted there would be a credential, and a
    // credential is the thing this design exists to avoid.
    const wrapped = withDemoAccess(fixtureAuthService);

    await expect(
      wrapped.login({
        email: DEMO_PATIENT_SESSION.identity.email,
        password: 'anything',
        rememberMe: true,
      }),
    ).rejects.toMatchObject({ kind: 'auth', code: 'invalid_credentials' });
  });

  it('changes nothing else on the service surface', () => {
    const wrapped = withDemoAccess(fixtureAuthService);
    expect(Object.keys(wrapped).sort()).toEqual(Object.keys(fixtureAuthService).sort());
    for (const key of Object.keys(fixtureAuthService) as (keyof AuthService)[]) {
      if (key === 'refresh') continue;
      expect(wrapped[key]).toBe(fixtureAuthService[key]);
    }
  });
});

describe('the adapters a release build actually runs', () => {
  it('refuses the demo token: the fixture adapter does not know it', async () => {
    // This is the production guarantee. `service.ts` applies
    // `withDemoAccess` only under `__DEV__`, so a release build hands the
    // stored token straight to one of these two — and neither restores a
    // session from it.
    await expect(fixtureAuthService.refresh(DEMO_PATIENT_REFRESH_TOKEN)).rejects.toMatchObject({
      kind: 'auth',
      code: 'unauthorized',
    });
  });

  it('refuses the demo token: the HTTP adapter has no local answer for it', async () => {
    // The HTTP adapter can only answer by asking the server, which has
    // never issued this token. It must not resolve locally under any
    // circumstances.
    await expect(httpAuthService.refresh(DEMO_PATIENT_REFRESH_TOKEN)).rejects.toBeDefined();
  });
});
