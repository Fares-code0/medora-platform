/**
 * The guard's decision table (RM M7.1).
 *
 * Driven through a real `Reflector` reading metadata off real decorated
 * classes rather than a mock returning canned values. The deny-by-default
 * case is the reason: the behaviour under test is "somebody forgot a
 * decorator", and a stubbed reflector returning `undefined` proves only
 * that the branch exists, not that a genuinely unannotated handler is
 * refused.
 */

import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception';
import { AuthorizationGuard } from './authorization.guard';
import { Can, Public, Roles } from './authz.decorators';
import { InMemoryPermissionCache } from './in-memory-permission-cache';
import { PermissionResolver } from './permission-resolver.service';
import { AUTHENTICATED_USER } from '../../common/auth/authenticated-user';
import { SEEDED_MATRIX } from './permission-catalogue';
import { NO_OVERRIDES, type RoleRepository } from './authz.types';
import type { PlatformRole, Principal } from './authz.types';

/* ── Fixture controllers ──────────────────────────────────────── */

class FixtureController {
  /** No decorator at all — the forgotten-annotation case. */
  unmarked(): void {}

  @Public()
  open(): void {}

  @Can('patients.view')
  viewPatients(): void {}

  @Can('patients.view', 'records.view')
  viewRecords(): void {}

  @Roles('admin')
  adminOnly(): void {}

  @Roles('admin', 'doctor')
  clinicalOrAdmin(): void {}

  @Roles('admin')
  @Can('logs.export')
  adminExport(): void {}

  /** Degenerate: the author meant to name a capability and did not. */
  @Can()
  emptyCan(): void {}
}

@Roles('admin')
class AdminController {
  classWide(): void {}

  /** Handler metadata must win over the class's. */
  @Roles('doctor')
  doctorOverride(): void {}

  @Public()
  publicOverride(): void {}
}

/* ── Harness ──────────────────────────────────────────────────── */

/**
 * The catalogue's own bundles, with no overrides. The guard's behaviour
 * is what is under test here, not the repository's, so this keeps the
 * decision table readable and independent of the database.
 */
const SEEDED_ROLES: RoleRepository = {
  currentMatrix: () => Promise.resolve(SEEDED_MATRIX),
  overridesFor: () => Promise.resolve(NO_OVERRIDES),
  userIdsWithRole: () => Promise.resolve([]),
};

function contextFor(target: object, method: string, principal?: Principal): ExecutionContext {
  // Written into M6's slot, because that is the only slot now — the
  // guard reads what AccessTokenGuard writes.
  const request = { headers: {} } as unknown as Request & Record<symbol, unknown>;
  if (principal !== undefined) {
    request[AUTHENTICATED_USER] = {
      id: principal.userId,
      publicId: `usr_${principal.userId}`,
      role: principal.roleCode,
      permissions: [],
      sessionId: 'sess-1',
    };
  }

  const handler = (target as unknown as Record<string, () => void>)[method];

  return {
    getHandler: () => handler,
    getClass: () => target.constructor,
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
  } as unknown as ExecutionContext;
}

function principal(roleCode: PlatformRole, userId = `u-${roleCode}`): Principal {
  return { userId, roleCode };
}

async function statusOf(guard: AuthorizationGuard, context: ExecutionContext): Promise<number> {
  try {
    await guard.canActivate(context);
    return HttpStatus.OK;
  } catch (error) {
    if (error instanceof AppException) return error.getStatus();
    throw error;
  }
}

describe('AuthorizationGuard', () => {
  let guard: AuthorizationGuard;
  let fixture: FixtureController;
  let adminController: AdminController;

  beforeEach(() => {
    const resolver = new PermissionResolver(SEEDED_ROLES, new InMemoryPermissionCache());
    guard = new AuthorizationGuard(new Reflector(), resolver);
    fixture = new FixtureController();
    adminController = new AdminController();
  });

  describe('deny by default', () => {
    it('refuses an unmarked route even for an administrator', async () => {
      // The whole argument of the guard's header, as one assertion.
      const status = await statusOf(guard, contextFor(fixture, 'unmarked', principal('admin')));

      expect(status).toBe(HttpStatus.FORBIDDEN);
    });

    it('refuses an unmarked route with no principal, as 403 not 401', async () => {
      // The route is refused because it names no rule, which is not a
      // statement about who is calling it.
      const status = await statusOf(guard, contextFor(fixture, 'unmarked'));

      expect(status).toBe(HttpStatus.FORBIDDEN);
    });

    it('treats an empty @Can() as no rule rather than a rule anyone meets', async () => {
      const status = await statusOf(guard, contextFor(fixture, 'emptyCan', principal('admin')));

      expect(status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe('@Public()', () => {
    it('admits an unauthenticated request', async () => {
      await expect(guard.canActivate(contextFor(fixture, 'open'))).resolves.toBe(true);
    });

    it('admits an authenticated one too', async () => {
      await expect(
        guard.canActivate(contextFor(fixture, 'open', principal('pharmacy'))),
      ).resolves.toBe(true);
    });

    it('wins over a class-wide @Roles', async () => {
      await expect(guard.canActivate(contextFor(adminController, 'publicOverride'))).resolves.toBe(
        true,
      );
    });
  });

  describe('authentication versus authorization (ADR-013)', () => {
    it('answers 401 when a guarded route has no principal', async () => {
      expect(await statusOf(guard, contextFor(fixture, 'viewPatients'))).toBe(
        HttpStatus.UNAUTHORIZED,
      );
      expect(await statusOf(guard, contextFor(fixture, 'adminOnly'))).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('answers 403, never 401, when the principal simply lacks the capability', async () => {
      // A 401 here would make ApiClient refresh and then log the user
      // out, signing a clinician out mid-shift over a missing capability.
      expect(await statusOf(guard, contextFor(fixture, 'adminOnly', principal('doctor')))).toBe(
        HttpStatus.FORBIDDEN,
      );
    });

    it('carries the contract codes', async () => {
      await expect(guard.canActivate(contextFor(fixture, 'viewPatients'))).rejects.toMatchObject({
        code: 'unauthorized',
      });

      await expect(
        guard.canActivate(contextFor(fixture, 'adminOnly', principal('doctor'))),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('never names the missing capability in the refusal', async () => {
      // A 403 that says which permission would have worked describes the
      // platform's internals to whoever is probing it.
      try {
        await guard.canActivate(contextFor(fixture, 'adminExport', principal('doctor')));
        expect.unreachable('expected a refusal');
      } catch (error) {
        const serialized = JSON.stringify(
          error instanceof AppException ? { message: error.message, code: error.code } : error,
        );

        expect(serialized).not.toContain('logs.export');
        expect(serialized).not.toContain('admin');
      }
    });
  });

  describe('@Can', () => {
    it('admits a principal whose bundle carries the capability', async () => {
      await expect(
        guard.canActivate(contextFor(fixture, 'viewPatients', principal('doctor'))),
      ).resolves.toBe(true);
    });

    it('refuses one whose bundle does not', async () => {
      // `pharmacy` holds patients.view but not records.view.
      expect(await statusOf(guard, contextFor(fixture, 'viewRecords', principal('pharmacy')))).toBe(
        HttpStatus.FORBIDDEN,
      );
    });

    it('requires every listed capability, not any of them', async () => {
      // reception holds patients.view but not records.view.
      expect(
        await statusOf(guard, contextFor(fixture, 'viewPatients', principal('reception'))),
      ).toBe(HttpStatus.OK);
      expect(
        await statusOf(guard, contextFor(fixture, 'viewRecords', principal('reception'))),
      ).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe('@Roles', () => {
    it('admits a listed role and refuses an unlisted one', async () => {
      expect(await statusOf(guard, contextFor(fixture, 'adminOnly', principal('admin')))).toBe(
        HttpStatus.OK,
      );
      expect(await statusOf(guard, contextFor(fixture, 'adminOnly', principal('reception')))).toBe(
        HttpStatus.FORBIDDEN,
      );
    });

    it('admits any of several listed roles', async () => {
      for (const role of ['admin', 'doctor'] as const) {
        expect(await statusOf(guard, contextFor(fixture, 'clinicalOrAdmin', principal(role)))).toBe(
          HttpStatus.OK,
        );
      }
      expect(
        await statusOf(guard, contextFor(fixture, 'clinicalOrAdmin', principal('laboratory'))),
      ).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe('@Roles and @Can together', () => {
    it('requires both to pass', async () => {
      // admin holds logs.export, so the pair succeeds.
      expect(await statusOf(guard, contextFor(fixture, 'adminExport', principal('admin')))).toBe(
        HttpStatus.OK,
      );
      // doctor fails the role check and would fail the capability too.
      expect(await statusOf(guard, contextFor(fixture, 'adminExport', principal('doctor')))).toBe(
        HttpStatus.FORBIDDEN,
      );
    });
  });

  describe('class-level metadata', () => {
    it('applies to a handler that declares none of its own', async () => {
      expect(
        await statusOf(guard, contextFor(adminController, 'classWide', principal('admin'))),
      ).toBe(HttpStatus.OK);
      expect(
        await statusOf(guard, contextFor(adminController, 'classWide', principal('doctor'))),
      ).toBe(HttpStatus.FORBIDDEN);
    });

    it('is overridden by handler metadata', async () => {
      expect(
        await statusOf(guard, contextFor(adminController, 'doctorOverride', principal('doctor'))),
      ).toBe(HttpStatus.OK);
      expect(
        await statusOf(guard, contextFor(adminController, 'doctorOverride', principal('admin'))),
      ).toBe(HttpStatus.FORBIDDEN);
    });
  });
});
