import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import type { ActivityRecorder } from '../../../shared/activity';
import type { AuditDispatcher } from '../../../shared/audit';
import { UserStatus } from '../../../generated/prisma/enums';
import type { PlatformUserRepository } from '../repositories/platform-user.repository';

import { PlatformUserService } from './platform-user.service';

/**
 * The four refusals (RM M8.2, API §2.10).
 *
 * Unit rather than e2e, and the reason is worth stating: the
 * last-administrator guard counts **every** active administrator in the
 * database, which is exactly what it should do and exactly what a
 * parallel e2e suite cannot control — another spec file's fixture
 * administrator would make the count two and the guard would correctly
 * decline to fire. The rule is a pure decision over a count, so it is
 * tested as one, with the count supplied.
 *
 * `users-account.e2e-spec.ts` covers the same service over HTTP for the
 * cases that *are* deterministic: self-edit, promotion to admin, unknown
 * role, unknown user, and the deactivation round trip.
 */

const ACTOR: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  publicId: 'usr_actor',
  role: 'admin',
  permissions: ['roles.manage'],
  sessionId: '22222222-2222-4222-8222-222222222222',
};

const TARGET_ID = '33333333-3333-4333-8333-333333333333';

interface RepoStub {
  readonly repository: PlatformUserRepository;
  readonly update: ReturnType<typeof vi.fn>;
  readonly revokeSessions: ReturnType<typeof vi.fn>;
}

function repositoryFor(options: {
  readonly targetRole: string;
  readonly targetStatus?: UserStatus;
  readonly activeWithRole?: number;
  readonly knownRoles?: readonly string[];
}): RepoStub {
  const update = vi.fn().mockResolvedValue({
    publicId: 'usr_target',
    displayName: 'Target Person',
    email: 'target@medora.test',
    status: options.targetStatus ?? UserStatus.ACTIVE,
    lastActiveAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    role: { code: options.targetRole },
  });
  const revokeSessions = vi.fn().mockResolvedValue(0);

  const repository = {
    findIdentity: vi.fn().mockResolvedValue({
      id: TARGET_ID,
      status: options.targetStatus ?? UserStatus.ACTIVE,
      role: { code: options.targetRole },
    }),
    findRoleByCode: vi.fn((code: string) =>
      Promise.resolve(
        (options.knownRoles ?? ['doctor', 'nurse', 'reception', 'admin']).includes(code)
          ? { id: `role_${code}`, code }
          : null,
      ),
    ),
    countActiveWithRole: vi.fn().mockResolvedValue(options.activeWithRole ?? 3),
    update,
    revokeSessions,
    list: vi.fn(),
    findByPublicId: vi.fn(),
  } as unknown as PlatformUserRepository;

  return { repository, update, revokeSessions };
}

function serviceFor(stub: RepoStub): PlatformUserService {
  const audit: AuditDispatcher = { record: vi.fn().mockResolvedValue(undefined) };
  const activity: ActivityRecorder = { record: vi.fn().mockResolvedValue(undefined) };
  // The activity feed's own service, added at M29.1 so an administrator
  // reads the same projection the account's owner does. None of the cases
  // in this file touches the feed, so the double only has to exist.
  const accounts = { activityFeed: vi.fn().mockResolvedValue(undefined) };

  return new PlatformUserService(
    stub.repository,
    accounts as never,
    audit,
    activity,
  );
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof AppException) return error.getStatus();
    throw error;
  }
}

describe('PlatformUserService.update — the four refusals', () => {
  it('refuses to demote the last active administrator', async () => {
    const stub = repositoryFor({ targetRole: 'admin', activeWithRole: 1 });
    const service = serviceFor(stub);

    const status = await statusOf(service.update(ACTOR, 'usr_target', { role: 'doctor' }));

    // A platform with nobody holding `roles.manage` cannot grant it
    // back: the matrix editor and this panel both require it.
    expect(status).toBe(409);
    expect(stub.update).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the last active administrator', async () => {
    const stub = repositoryFor({ targetRole: 'admin', activeWithRole: 1 });
    const service = serviceFor(stub);

    // `status != ACTIVE` refuses sign-in, so this is a demotion by
    // another name and has to be refused the same way.
    expect(await statusOf(service.update(ACTOR, 'usr_target', { active: false }))).toBe(409);
    expect(stub.update).not.toHaveBeenCalled();
  });

  it('allows demoting an administrator while others remain', async () => {
    const stub = repositoryFor({ targetRole: 'admin', activeWithRole: 2 });
    const service = serviceFor(stub);

    expect(await statusOf(service.update(ACTOR, 'usr_target', { role: 'doctor' }))).toBe(200);
    expect(stub.update).toHaveBeenCalledOnce();
  });

  it('does not count administrators when the target is not one', async () => {
    const stub = repositoryFor({ targetRole: 'doctor', activeWithRole: 1 });
    const service = serviceFor(stub);

    expect(await statusOf(service.update(ACTOR, 'usr_target', { active: false }))).toBe(200);
    // The guard is about administration surviving, not about every
    // deactivation — a clinic with one doctor may still suspend them.
    expect(stub.repository.countActiveWithRole).not.toHaveBeenCalled();
  });

  it('refuses promotion to a role that requires an enrolled second factor', async () => {
    const stub = repositoryFor({ targetRole: 'doctor' });
    const service = serviceFor(stub);

    // ADR-035 §7: the only path that sets an admin account ACTIVE is the
    // invitation flow's phase 2, immediately after a TOTP code is proved.
    expect(await statusOf(service.update(ACTOR, 'usr_target', { role: 'admin' }))).toBe(409);
    expect(stub.update).not.toHaveBeenCalled();
  });

  it('refuses an administrator editing their own row', async () => {
    const stub = repositoryFor({ targetRole: 'admin', activeWithRole: 5 });
    // Make the target the actor.
    (stub.repository.findIdentity as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: ACTOR.id,
      status: UserStatus.ACTIVE,
      role: { code: 'admin' },
    });
    const service = serviceFor(stub);

    expect(await statusOf(service.update(ACTOR, 'usr_actor', { active: false }))).toBe(403);
    expect(stub.update).not.toHaveBeenCalled();
  });

  it('ends live sessions when an account is deactivated', async () => {
    const stub = repositoryFor({ targetRole: 'doctor', targetStatus: UserStatus.INACTIVE });
    const service = serviceFor(stub);

    await service.update(ACTOR, 'usr_target', { active: false });

    // Without this the lever does nothing for the case it is pulled in —
    // an account being used right now.
    expect(stub.revokeSessions).toHaveBeenCalledWith(TARGET_ID);
  });

  it('leaves sessions alone when only the role changes', async () => {
    const stub = repositoryFor({ targetRole: 'nurse' });
    const service = serviceFor(stub);

    await service.update(ACTOR, 'usr_target', { role: 'nurse' });

    expect(stub.revokeSessions).not.toHaveBeenCalled();
  });

  it('answers 422 for an unknown role code and 404 for an unknown user', async () => {
    const stub = repositoryFor({ targetRole: 'doctor' });
    const service = serviceFor(stub);

    expect(await statusOf(service.update(ACTOR, 'usr_target', { role: 'wizard' }))).toBe(422);

    (stub.repository.findIdentity as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await statusOf(service.update(ACTOR, 'usr_missing', { active: false }))).toBe(404);
  });
});
