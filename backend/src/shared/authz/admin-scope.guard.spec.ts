import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { AUTHENTICATED_USER, type AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  ADMIN_SCOPE_METADATA,
  AdminScopeGuard,
  type AdminScopeMode,
  type AdminScopeRule,
} from './admin-scope.guard';
import type { AdminScope, AdminScopeService } from './admin-scope.service';

const PLATFORM: AdminScope = { kind: 'platform' };
const HOSPITAL: AdminScope = { kind: 'hospital', hospitalId: 'h', hospitalName: 'H' };
const NONE: AdminScope = { kind: 'none', reason: 'not_mapped' };

function user(role: string): AuthenticatedUser {
  return { id: 'u', publicId: 'usr_u', role, permissions: [], sessionId: 's' };
}

function run(
  rule: AdminScopeRule | undefined,
  scope: AdminScope,
  principal: AuthenticatedUser | null = user('admin'),
) {
  const handler = (): void => undefined;
  class Target {}
  if (rule !== undefined) Reflect.defineMetadata(ADMIN_SCOPE_METADATA, rule, handler);
  const request: Record<string | symbol, unknown> = {};
  if (principal !== null) request[AUTHENTICATED_USER] = principal;
  const context = {
    getHandler: () => handler,
    getClass: () => Target,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const scopes = { forRequest: () => Promise.resolve(scope) } as unknown as AdminScopeService;
  return new AdminScopeGuard(new Reflector(), scopes).canActivate(context);
}

const status = async (promise: Promise<boolean>): Promise<number> => {
  try {
    await promise;
    return 200;
  } catch (error) {
    return (error as { getStatus(): number }).getStatus();
  }
};

describe('AdminScopeGuard', () => {
  const table: readonly [AdminScopeMode, AdminScope, number][] = [
    ['platform', PLATFORM, 200],
    ['platform', HOSPITAL, 403],
    ['platform', NONE, 403],
    ['any', PLATFORM, 200],
    ['any', HOSPITAL, 200],
    ['any', NONE, 403],
    ['hospital', PLATFORM, 403],
    ['hospital', HOSPITAL, 200],
    ['hospital', NONE, 403],
  ];

  it.each(table)('mode %s, scope %o → %i', async (mode, scope, expected) => {
    expect(await status(run({ mode }, scope))).toBe(expected);
  });

  it('refuses a non-admin role unless the rule names it', async () => {
    expect(await status(run({ mode: 'any' }, PLATFORM, user('doctor')))).toBe(403);
    expect(
      await status(run({ mode: 'hospital', otherRoles: ['reception'] }, NONE, user('reception'))),
    ).toBe(200);
  });

  it('fails closed without a rule, and is 401 without a principal', async () => {
    expect(await status(run(undefined, PLATFORM))).toBe(403);
    expect(await status(run({ mode: 'any' }, PLATFORM, null))).toBe(401);
  });
});
