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

import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllowEndedSession } from '../../../common/auth/allow-ended-session.decorator';
import {
  AUTHENTICATED_USER,
  type AuthenticatedUser,
} from '../../../common/auth/authenticated-user';
import { Public } from '../../../common/auth/public.decorator';
import { AppException } from '../../../common/errors/app.exception';
import type { AccessTokenService } from '../services/access-token.service';
import type { SessionService } from '../services/session.service';

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
};

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
  typeof vi.fn<(sid: string, sub: string, role?: string) => Promise<boolean>>
>;
let belongsTo: ReturnType<typeof vi.fn<(sid: string, sub: string) => Promise<boolean>>>;
let guard: AccessTokenGuard;

beforeEach(() => {
  verify = vi.fn<(token: string) => Promise<AuthenticatedUser | null>>(() =>
    Promise.resolve(PRINCIPAL),
  );
  isActive = vi.fn<(sid: string, sub: string, role?: string) => Promise<boolean>>(() =>
    Promise.resolve(true),
  );
  belongsTo = vi.fn<(sid: string, sub: string) => Promise<boolean>>(() => Promise.resolve(true));
  guard = new AccessTokenGuard(
    new Reflector(),
    { verify } as unknown as AccessTokenService,
    { isActive, belongsTo } as unknown as SessionService,
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
    isActive.mockResolvedValueOnce(false);
    const { context, request } = contextFor('guarded', 'Bearer good');

    const error = await refusal(guard.canActivate(context));

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.code).toBe('unauthorized');
    // No principal is attached: a later guard or handler must not see one.
    expect(request[AUTHENTICATED_USER]).toBeUndefined();
  });

  it('lets @AllowEndedSession() through an ended session, waiving liveness only', async () => {
    isActive.mockResolvedValue(false);
    const { context, request } = contextFor('logout', 'Bearer good');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(isActive).not.toHaveBeenCalled();
    // Identity is still checked: the token's session, for the token's user.
    expect(belongsTo).toHaveBeenCalledWith(PRINCIPAL.sessionId, PRINCIPAL.id);
    expect(request[AUTHENTICATED_USER]).toEqual(PRINCIPAL);
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
    isActive.mockResolvedValueOnce(false);
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
