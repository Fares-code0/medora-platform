import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/api/client';

import { httpAuthService } from './auth';

/**
 * RM M40.5 — browser storage is not a source of authorization in a live
 * build.
 *
 * The demo backend keeps its session in `localStorage` (`medora.session`),
 * the retired client-only development sign-in kept one under
 * `medora.dev-demo-session` (a stale copy can still be there), and the
 * demo clinic store keeps clinic state under `medora.admin.clinic.v1`. Each
 * is plain text any script or person at the keyboard can write. The live
 * adapter must never read a session, a role, permissions or a clinic from
 * them: the only way to a session is the server's answer to the httpOnly
 * refresh cookie.
 */

const FORGED_SESSION = {
  user: {
    id: 'usr_forged',
    name: 'Forged Admin',
    email: 'forged@example.test',
    role: 'admin',
    permissions: ['patients.revealIdentity', 'roles.manage'],
    clinicId: 'clinic-meadowbrook',
  },
  accessToken: 'forged-access-token',
};

function plantForgeries(): void {
  const forged = JSON.stringify(FORGED_SESSION);
  window.localStorage.setItem('medora.session', forged);
  window.sessionStorage.setItem('medora.session', forged);
  window.localStorage.setItem('medora.dev-demo-session', forged);
  window.localStorage.setItem(
    'medora.admin.clinic.v1',
    JSON.stringify({ phiAccess: [{ subjectId: 'PT-1001', actor: 'Forged Admin' }] }),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  if (!globalThis.crypto?.randomUUID) {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-correlation-id' });
  }
  apiClient.setAccessToken(null);
  apiClient.setUnauthorizedHandler(null);
  plantForgeries();
});

afterEach(() => {
  vi.unstubAllGlobals();
  apiClient.setAccessToken(null);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('a live restore with forged browser storage', () => {
  it('yields no session when the server does not recognise the cookie', async () => {
    fetchMock.mockResolvedValue(json({ code: 'unauthorized', message: 'Session expired' }, 401));

    await expect(httpAuthService.restore()).resolves.toBeNull();

    // One request, to the server, carrying no token from storage.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toMatch(/\/auth\/refresh$/);
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('takes role, permissions and clinic from the server, never from storage', async () => {
    fetchMock.mockResolvedValue(
      json({
        data: {
          user: {
            id: 'usr_real',
            name: 'Dr. Real',
            email: 'real@example.test',
            role: 'doctor',
            permissions: ['patients.view'],
          },
          accessToken: 'server-access-token',
          expiresIn: 900,
        },
      }),
    );

    const session = await httpAuthService.restore();

    expect(session?.user).toMatchObject({ id: 'usr_real', role: 'doctor' });
    expect(session?.user.permissions).toEqual(['patients.view']);
    // The live session carries no clinic: nothing in it can be widened by
    // what the demo store or a forged session say.
    expect(session?.user.clinicId).toBeUndefined();
    expect(session?.accessToken).toBe('server-access-token');
  });

  it('writes nothing to browser storage when a session is kept', () => {
    window.localStorage.clear();
    window.sessionStorage.clear();

    httpAuthService.persist(
      {
        user: {
          id: 'usr_real',
          name: 'Dr. Real',
          email: 'real@example.test',
          role: 'doctor',
          permissions: [],
        },
        accessToken: 'server-access-token',
        expiresIn: 900,
      },
      true,
    );

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
