/**
 * The access-token guard's decision table, including PRE-01's session
 * check (owner decisions I4, O-13).
 *
 * A real `Reflector` reads metadata off real decorated handlers, for the
 * reason `authorization.guard.spec.ts` gives: the behaviour that matters
 * is what an *undecorated* route does, and a stubbed reflector cannot
 * show that. The two collaborators are fakes because their own behaviour
 * is covered elsewhere — signature checks in `access-token-forgery`, the
 * session read against PostgreSQL in `session-validation`. What is under
 * test here is the order of the checks and which ones each route runs.
 */

import { Controller, Get, HttpStatus, Patch, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllowEndedSession } from '../../../common/auth/allow-ended-session.decorator';
import {
  AUTHENTICATED_USER,
  type AuthenticatedUser,
} from '../../../common/auth/authenticated-user';
import { Public } from '../../../common/auth/public.decorator';
import { AppException } from '../../../common/errors/app.exception';
import type { PermissionResolver, Principal } from '../../../shared/authz';
import type { AccessTokenService } from '../services/access-token.service';
import type { ActiveAccount, SessionService } from '../services/session.service';

import { AccessTokenGuard } from './access-token.guard';

class FixtureController {
  guarded(): void {}

  @Public()
  open(): void {}

  @AllowEndedSession()
  logout(): void {}
}

/** A controller-level marker — which the guard must ignore. */
@AllowEndedSession()
class MarkedController {
  ordinary(): void {}
}

const PRINCIPAL: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  publicId: 'usr_fixture',
  role: 'doctor',
  permissions: ['patients.view'],
  sessionId: '22222222-2222-4222-8222-222222222222',
  permissionVersion: 4,
};

/** What the database answers as the account's permission version by default. */
const CURRENT_VERSION = 4;

/** The guard's per-request read, for an account that is not a suspended doctor by default. */
function account(permissionVersion: number, practiceSuspended = false): ActiveAccount {
  return { permissionVersion, practiceSuspended };
}

type Handler = keyof FixtureController;

function contextFor(
  handler: Handler | 'ordinary',
  authorization?: string,
  controller: typeof FixtureController | typeof MarkedController = FixtureController,
) {
  const request: Record<string | symbol, unknown> = {
    headers: authorization === undefined ? {} : { authorization },
  };
  const context = {
    getHandler: () =>
      controller === MarkedController
        ? MarkedController.prototype.ordinary
        : FixtureController.prototype[handler as Handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

let verify: ReturnType<typeof vi.fn<(token: string) => Promise<AuthenticatedUser | null>>>;
let isActive: ReturnType<
  typeof vi.fn<(sid: string, sub: string, role?: string) => Promise<ActiveAccount | null>>
>;
let permissionsFor: ReturnType<typeof vi.fn<(principal: Principal) => Promise<readonly string[]>>>;
let belongsTo: ReturnType<typeof vi.fn<(sid: string, sub: string) => Promise<boolean>>>;
let guard: AccessTokenGuard;

beforeEach(() => {
  verify = vi.fn<(token: string) => Promise<AuthenticatedUser | null>>(() =>
    Promise.resolve(PRINCIPAL),
  );
  // `isActive` here is `SessionService.activePermissionVersion`: the same
  // read, answering the account's permission version or `null` (G4).
  isActive = vi.fn<(sid: string, sub: string, role?: string) => Promise<ActiveAccount | null>>(() =>
    Promise.resolve(account(CURRENT_VERSION)),
  );
  permissionsFor = vi.fn<(principal: Principal) => Promise<readonly string[]>>(() =>
    Promise.resolve(['records.view', 'patients.view']),
  );
  belongsTo = vi.fn<(sid: string, sub: string) => Promise<boolean>>(() => Promise.resolve(true));
  guard = new AccessTokenGuard(
    new Reflector(),
    { verify } as unknown as AccessTokenService,
    { activePermissionVersion: isActive, belongsTo } as unknown as SessionService,
    { permissionsFor } as unknown as PermissionResolver,
  );
});

async function refusal(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }
  throw new Error('expected the guard to refuse');
}

describe('AccessTokenGuard', () => {
  it('lets a public route through without reading a token or a session', async () => {
    const { context } = contextFor('open');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(isActive).not.toHaveBeenCalled();
  });

  it('refuses a guarded route with no bearer token, before any session read', async () => {
    const error = await refusal(guard.canActivate(contextFor('guarded').context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(isActive).not.toHaveBeenCalled();
  });

  it('refuses a token that does not verify, before any session read', async () => {
    verify.mockResolvedValueOnce(null);

    const error = await refusal(guard.canActivate(contextFor('guarded', 'Bearer forged').context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(isActive).not.toHaveBeenCalled();
  });

  it('checks the session named by the token, for the user and role named by the token', async () => {
    const { context, request } = contextFor('guarded', 'Bearer good');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // F3 / ADR-046: the role claim is checked against the account's current role.
    expect(isActive).toHaveBeenCalledWith(PRINCIPAL.sessionId, PRINCIPAL.id, PRINCIPAL.role);
    expect(request[AUTHENTICATED_USER]).toEqual(PRINCIPAL);
  });

  it('refuses a validly signed token whose session is no longer live — 401 unauthorized', async () => {
    isActive.mockResolvedValueOnce(null);
    const { context, request } = contextFor('guarded', 'Bearer good');

    const error = await refusal(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.code).toBe('unauthorized');
    // No principal is attached: a later guard or handler must not see one.
    expect(request[AUTHENTICATED_USER]).toBeUndefined();
  });

  it('lets @AllowEndedSession() through an ended session, waiving liveness only', async () => {
    isActive.mockResolvedValue(null);
    const { context, request } = contextFor('logout', 'Bearer good');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(isActive).not.toHaveBeenCalled();
    // Identity is still checked: the token's session, for the token's user.
    expect(belongsTo).toHaveBeenCalledWith(PRINCIPAL.sessionId, PRINCIPAL.id);
    // No version was read, so neither the version nor the permission claim
    // is carried (G4): nothing on this path is authorized by a stale claim.
    const { permissionVersion: _version, ...identity } = PRINCIPAL;
    expect(request[AUTHENTICATED_USER]).toEqual({ ...identity, permissions: [] });
  });

  it('refuses @AllowEndedSession() when the session is not the subject’s — 401', async () => {
    belongsTo.mockResolvedValueOnce(false);
    const { context, request } = contextFor('logout', 'Bearer good');

    const error = await refusal(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.code).toBe('unauthorized');
    expect(request[AUTHENTICATED_USER]).toBeUndefined();
  });

  it('ignores the marker on a controller: its routes still need a live session', async () => {
    isActive.mockResolvedValueOnce(null);
    const { context } = contextFor('ordinary', 'Bearer good', MarkedController);

    const error = await refusal(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(isActive).toHaveBeenCalledWith(PRINCIPAL.sessionId, PRINCIPAL.id, PRINCIPAL.role);
    expect(belongsTo).not.toHaveBeenCalled();
  });

  it('does not read the session at all for ordinary routes through the ended-session path', async () => {
    await guard.canActivate(contextFor('guarded', 'Bearer good').context);

    expect(isActive).toHaveBeenCalledTimes(1);
    expect(belongsTo).not.toHaveBeenCalled();
  });

  it('does not relax the signature check for @AllowEndedSession()', async () => {
    verify.mockResolvedValueOnce(null);

    const error = await refusal(guard.canActivate(contextFor('logout', 'Bearer forged').context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('propagates a database failure on the logout path too', async () => {
    belongsTo.mockRejectedValueOnce(new Error('connection refused'));

    await expect(guard.canActivate(contextFor('logout', 'Bearer good').context)).rejects.toThrow(
      'connection refused',
    );
  });

  it('propagates a database failure rather than letting the request through', async () => {
    // Fail closed: if the session cannot be read, the request is not
    // authenticated. The exception filter turns this into a 5xx.
    isActive.mockRejectedValueOnce(new Error('connection refused'));

    await expect(guard.canActivate(contextFor('guarded', 'Bearer good').context)).rejects.toThrow(
      'connection refused',
    );
  });
});

describe('AccessTokenGuard — permission version (G4, ADR-047)', () => {
  it('trusts the permission claim when the token was minted at the current version', async () => {
    const { context, request } = contextFor('guarded', 'Bearer good');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(permissionsFor).not.toHaveBeenCalled();
    expect(request[AUTHENTICATED_USER]).toEqual(PRINCIPAL);
  });

  it('replaces a stale permission claim with a fresh resolution at the current version', async () => {
    isActive.mockResolvedValueOnce(account(CURRENT_VERSION + 1));
    const { context, request } = contextFor('guarded', 'Bearer good');

    // Not a 401: an ordinary permission change applies on the same token.
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(permissionsFor).toHaveBeenCalledWith({
      userId: PRINCIPAL.id,
      roleCode: PRINCIPAL.role,
      sessionId: PRINCIPAL.sessionId,
      permissionVersion: CURRENT_VERSION + 1,
    });
    expect(request[AUTHENTICATED_USER]).toEqual({
      ...PRINCIPAL,
      // Sorted, as the token's claim is.
      permissions: ['patients.view', 'records.view'],
      permissionVersion: CURRENT_VERSION + 1,
    });
  });

  it('treats a token minted before the pv claim existed as stale', async () => {
    const { permissionVersion: _version, ...legacy } = PRINCIPAL;
    verify.mockResolvedValueOnce(legacy);
    const { context, request } = contextFor('guarded', 'Bearer legacy');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(permissionsFor).toHaveBeenCalledTimes(1);
    expect((request[AUTHENTICATED_USER] as AuthenticatedUser | undefined)?.permissionVersion).toBe(
      CURRENT_VERSION,
    );
  });

  it('fails closed when a stale claim cannot be re-resolved', async () => {
    isActive.mockResolvedValueOnce(account(CURRENT_VERSION + 1));
    permissionsFor.mockRejectedValueOnce(new Error('database down'));
    const { context, request } = contextFor('guarded', 'Bearer good');

    await expect(guard.canActivate(context)).rejects.toThrow('database down');
    expect(request[AUTHENTICATED_USER]).toBeUndefined();
  });

  it('attaches the version it read, whatever the token claimed', async () => {
    verify.mockResolvedValueOnce({ ...PRINCIPAL, permissionVersion: 99 });
    const { context, request } = contextFor('guarded', 'Bearer good');

    await guard.canActivate(context);

    expect((request[AUTHENTICATED_USER] as AuthenticatedUser | undefined)?.permissionVersion).toBe(
      CURRENT_VERSION,
    );
  });
});

/**
 * #18 — a suspended doctor keeps their own account and nothing else.
 * Real `@Controller`/`@Get` metadata, because the allow-list is keyed on
 * exactly that metadata.
 */
@Controller('me/profile')
class ProfileFixture {
  @Get()
  read(): void {}

  @Patch()
  update(): void {}
}

@Controller('auth')
class AuthFixture {
  @Get('session')
  session(): void {}
}

@Controller('patients')
class ClinicalFixture {
  @Get(':patientId')
  read(): void {}
}

// `GET me/settings` is readable by a suspended doctor (owner decision
// 2026-11-24); writing a section is not.
@Controller('me')
class SettingsFixture {
  @Patch('settings/:section')
  settings(): void {}
}

function routeContext(controller: object, handler: () => void) {
  const request: Record<string | symbol, unknown> = { headers: { authorization: 'Bearer good' } };
  const context = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AccessTokenGuard — suspended doctor (#18)', () => {
  it('lets a suspended doctor reach their own profile and session', async () => {
    isActive.mockResolvedValue(account(CURRENT_VERSION, true));

    for (const [controller, handler] of [
      [ProfileFixture, ProfileFixture.prototype.read],
      [ProfileFixture, ProfileFixture.prototype.update],
      [AuthFixture, AuthFixture.prototype.session],
    ] as const) {
      const { context, request } = routeContext(controller, handler);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request[AUTHENTICATED_USER]).toEqual(PRINCIPAL);
    }
  });

  it('refuses a suspended doctor anything else — 403 practice_suspended, no principal', async () => {
    isActive.mockResolvedValue(account(CURRENT_VERSION, true));

    for (const [controller, handler] of [
      [ClinicalFixture, ClinicalFixture.prototype.read],
      [SettingsFixture, SettingsFixture.prototype.settings],
    ] as const) {
      const { context, request } = routeContext(controller, handler);
      const error = await refusal(guard.canActivate(context));
      expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(error.code).toBe('practice_suspended');
      expect(request[AUTHENTICATED_USER]).toBeUndefined();
    }
  });

  it('fails closed on a handler with no routing metadata', async () => {
    isActive.mockResolvedValueOnce(account(CURRENT_VERSION, true));

    const error = await refusal(guard.canActivate(contextFor('guarded', 'Bearer good').context));

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(error.code).toBe('practice_suspended');
  });

  it('does not restrict an account that is not suspended', async () => {
    const { context } = routeContext(ClinicalFixture, ClinicalFixture.prototype.read);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
