import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_ROLES, SEEDED_MATRIX } from '../src/shared/authz';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * Roles & permissions over HTTP (RM M7.4, API §15).
 *
 * The milestone's verify step is "concurrent matrix edit test → 409 with
 * merge payload", and it is driven here the way a concurrent edit
 * actually happens: two administrators read the same revision, both
 * save, and the second is refused — not by simulating a clock, but by
 * letting the compare-and-set inside the transaction do its job.
 *
 * The other cases are the ones the algebra was written for at M7 and
 * has had no endpoint to be enforced through until now: a locked cell is
 * **rejected**, not silently repaired (reconciliation §5 rule 2 —
 * "rejected, not merely hidden in the UI"), and a grid that leaves a
 * capability with no role at all is refused rather than accepted and
 * discovered later.
 *
 * Every test restores the matrix afterwards. These routes write the rows
 * every authorization decision in the application is made from, and a
 * spec file that left `doctor` without `patients.view` would fail every
 * other suite in ways that look nothing like its own cause.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const ROLES = '/api/v1/roles';
const PERMISSIONS_ROUTE = '/api/v1/permissions';
const MATRIX = '/api/v1/roles/matrix';
const PREVIEW = '/api/v1/roles/matrix/preview';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

type Grid = Record<string, string[]>;

interface MatrixView {
  matrix: Grid;
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
}

interface RoleView {
  id: string;
  code: string;
  label: string;
  baseRole: string | null;
  system: boolean;
  members: number;
  activeMembers: number;
  inMatrix: boolean;
}

interface MatrixChange {
  role: string;
  capability: string;
  next: boolean;
  phi: boolean;
}

interface PreviewView {
  changes: MatrixChange[];
  roles: { role: string; grants: number; revokes: number; activeUsers: number }[];
  affectedUsers: number;
  phiGrants: MatrixChange[];
  orphaned: string[];
}

interface UserPermissionsView {
  userId: string;
  role: string;
  fromRole: string[];
  granted: string[];
  revoked: string[];
  effective: string[];
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function seedAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return email;
}

async function tokenFor(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<SessionPayload>(response).accessToken;
}

/** An administrator token, built the only way ADR-035 §7 allows one. */
async function adminToken(local: string): Promise<string> {
  const email = await seedAccount(local);
  const bootstrap = await tokenFor(email);

  const setup = await request(harness.server)
    .post('/api/v1/me/2fa/setup')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ password: PASSWORD });
  const secret = dataOf<{ secret: string }>(setup).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });

  return dataOf<SessionPayload>(verified).accessToken;
}

async function readMatrix(token: string): Promise<MatrixView> {
  const response = await request(harness.server)
    .get(MATRIX)
    .set('Authorization', `Bearer ${token}`);

  return dataOf<MatrixView>(response);
}

/** The seeded grid, as a plain object the routes accept. */
function seededGrid(): Grid {
  return Object.fromEntries(PLATFORM_ROLES.map((role) => [role, [...SEEDED_MATRIX[role]]]));
}

/**
 * Puts the matrix back exactly as the seed left it.
 *
 * Not optional cleanup: these rows are what every `@Can(...)` in the
 * application resolves against, and a suite that left them edited would
 * break unrelated files in a way that points nowhere near here.
 */
async function restoreMatrix(token: string): Promise<void> {
  const current = await readMatrix(token);
  await request(harness.server)
    .put(MATRIX)
    .set('Authorization', `Bearer ${token}`)
    .send({ grid: seededGrid(), revision: current.revision, confirm: true });
}

beforeAll(async () => {
  harness = await createAuthHarness('roles-permissions');
}, 60_000);

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('authorization on the §15 surface', () => {
  it('refuses a doctor on every route', async () => {
    const email = await seedAccount('doctor');
    const token = await tokenFor(email);

    for (const [method, path] of [
      ['get', ROLES],
      ['get', PERMISSIONS_ROUTE],
      ['get', MATRIX],
      ['post', PREVIEW],
      ['put', MATRIX],
      ['post', ROLES],
    ] as const) {
      const agent = request(harness.server);
      const response = await agent[method](path)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // `roles.manage` is locked off for every role but admin, so a
      // doctor cannot reach these however their overrides are set.
      expect(response.status).toBe(403);
    }
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(harness.server).get(MATRIX)).status).toBe(401);
  });
});

describe('GET /roles and GET /permissions (§15.1)', () => {
  it('lists roles with member counts and flags the ones with no matrix column', async () => {
    const token = await adminToken('lister');

    const response = await request(harness.server)
      .get(ROLES)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    const roles = dataOf<RoleView[]>(response);
    const doctor = roles.find((role) => role.code === 'doctor');
    expect(doctor?.inMatrix).toBe(true);
    expect(doctor?.members).toBeGreaterThan(0);
    expect(doctor?.activeMembers).toBeLessThanOrEqual(doctor?.members ?? 0);

    // `nurse` is the standing example: a role a user can hold with no
    // column in the matrix (ADR-017 §6).
    expect(roles.find((role) => role.code === 'nurse')?.inMatrix).toBe(false);
  });

  it('returns the 22-capability catalogue grouped by domain', async () => {
    const token = await adminToken('catalogue');

    const response = await request(harness.server)
      .get(PERMISSIONS_ROUTE)
      .set('Authorization', `Bearer ${token}`);

    const catalogue = dataOf<{
      groups: { group: string; capabilities: { id: string; phi: boolean }[] }[];
      total: number;
    }>(response);

    expect(catalogue.total).toBe(22);
    expect(catalogue.groups.flatMap((group) => group.capabilities)).toHaveLength(22);
    // PHI-reaching capabilities are flagged so the confirmation screen
    // can highlight a grant that reaches patient data.
    expect(
      catalogue.groups
        .flatMap((group) => group.capabilities)
        .find((capability) => capability.id === 'records.view')?.phi,
    ).toBe(true);
  });
});

describe('GET /roles/matrix (§15.2)', () => {
  it('returns the seeded grid with a revision', async () => {
    const token = await adminToken('reader');

    const view = await readMatrix(token);

    expect(view.revision).toBeGreaterThanOrEqual(1);
    expect(Object.keys(view.matrix).sort()).toEqual([...PLATFORM_ROLES].sort());
    // The stored rows and the catalogue's transcription of them must
    // agree — `authz-repositories.e2e-spec.ts` asserts the same thing
    // from the repository side.
    expect([...(view.matrix['doctor'] ?? [])].sort()).toEqual([...SEEDED_MATRIX.doctor].sort());
  });
});

describe('POST /roles/matrix/preview (§15.3)', () => {
  it('reports the change set, the affected roles and the PHI grants', async () => {
    const token = await adminToken('previewer');

    const grid = seededGrid();
    // Grant a PHI capability the pharmacy role does not have.
    grid['pharmacy'] = [...(grid['pharmacy'] ?? []), 'records.view'];

    const response = await request(harness.server)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid });

    expect(response.status).toBe(200);

    const preview = dataOf<PreviewView>(response);
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0]).toMatchObject({
      role: 'pharmacy',
      capability: 'records.view',
      next: true,
      phi: true,
    });
    expect(preview.phiGrants).toHaveLength(1);
    expect(preview.roles.map((entry) => entry.role)).toEqual(['pharmacy']);
    expect(preview.orphaned).toEqual([]);
  });

  it('reports an empty change set for the grid as it stands', async () => {
    const token = await adminToken('nochange');

    const response = await request(harness.server)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid: seededGrid() });

    expect(dataOf<PreviewView>(response).changes).toEqual([]);
    expect(dataOf<PreviewView>(response).affectedUsers).toBe(0);
  });

  it('names the capabilities a grid would orphan', async () => {
    const token = await adminToken('orphaner');

    const grid = seededGrid();
    for (const role of PLATFORM_ROLES) {
      grid[role] = (grid[role] ?? []).filter((code) => code !== 'ai.use');
    }

    const response = await request(harness.server)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid });

    // A feature nobody can reach. The preview names it so the save does
    // not have to be the first time anyone notices.
    expect(dataOf<PreviewView>(response).orphaned).toContain('ai.use');
  });

  it('rejects an unknown capability code with 422', async () => {
    const token = await adminToken('badcode');

    const grid = seededGrid();
    grid['doctor'] = [...(grid['doctor'] ?? []), 'patients.deleteEverything'];

    const response = await request(harness.server)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid });

    expect(response.status).toBe(422);
  });

  it('rejects a partial grid', async () => {
    const token = await adminToken('partial');

    const response = await request(harness.server)
      .post(PREVIEW)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid: { doctor: [] } });

    // "The roles you did not mention keep what they had" is a rule that
    // silently preserves a cell an administrator believed they cleared.
    expect(response.status).toBe(422);
  });
});

describe('PUT /roles/matrix (§15.3)', () => {
  it('saves, bumps the revision, and records who saved', async () => {
    const token = await adminToken('saver');
    const before = await readMatrix(token);

    const grid = seededGrid();
    grid['pharmacy'] = [...(grid['pharmacy'] ?? []), 'records.view'];

    const response = await request(harness.server)
      .put(MATRIX)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid, revision: before.revision, confirm: true });

    expect(response.status).toBe(200);

    const after = dataOf<MatrixView>(response);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.updatedBy).toMatch(/^usr_/);
    expect(after.matrix['pharmacy']).toContain('records.view');

    // The rows, not just the response: the resolver reads the join table.
    const stored = await harness.prisma.rolePermission.count({
      where: { role: { code: 'pharmacy' }, permission: { code: 'records.view' } },
    });
    expect(stored).toBe(1);

    await restoreMatrix(token);
  });

  it('answers 409 with both change sets when the revision is stale', async () => {
    const token = await adminToken('racer');
    const opened = await readMatrix(token);

    // Administrator A saves.
    const firstGrid = seededGrid();
    firstGrid['pharmacy'] = [...(firstGrid['pharmacy'] ?? []), 'records.view'];
    const first = await request(harness.server)
      .put(MATRIX)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid: firstGrid, revision: opened.revision, confirm: true });
    expect(first.status).toBe(200);

    // Administrator B, who opened the editor at the same revision, saves
    // a different change.
    const secondGrid = seededGrid();
    // `records.view` is not locked for laboratory — `prescriptions.create`
    // is (lockedOff for reception/laboratory/pharmacy), and using it here
    // would produce the lock 409 instead of the revision one.
    secondGrid['laboratory'] = [...(secondGrid['laboratory'] ?? []), 'ai.use'];
    const second = await request(harness.server)
      .put(MATRIX)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid: secondGrid, revision: opened.revision, confirm: true });

    expect(second.status).toBe(409);

    const conflict = JSON.parse(errorBody(second).detail ?? '{}') as {
      current: MatrixView;
      yours: MatrixChange[];
      theirs: MatrixChange[];
    };

    // The merge dialog needs all three: what B wanted, how the saved
    // grid differs from what B is holding, and the grid to rebase on.
    expect(conflict.current.revision).toBe(opened.revision + 1);
    expect(conflict.yours.map((change) => change.capability)).toContain('ai.use');
    expect(conflict.theirs.length).toBeGreaterThan(0);

    // B's save landed nowhere.
    const stored = await harness.prisma.rolePermission.count({
      where: { role: { code: 'laboratory' }, permission: { code: 'ai.use' } },
    });
    expect(stored).toBe(0);

    await restoreMatrix(token);
  });

  it('rejects a grid that moves a locked cell rather than repairing it', async () => {
    const token = await adminToken('locksmith');
    const before = await readMatrix(token);

    const grid = seededGrid();
    // `roles.manage` is locked on for admin. Taking it away would leave
    // the platform unable to grant it back.
    grid['admin'] = (grid['admin'] ?? []).filter((code) => code !== 'roles.manage');

    const response = await request(harness.server)
      .put(MATRIX)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid, revision: before.revision, confirm: true });

    expect(response.status).toBe(409);
    expect(errorBody(response).detail).toContain('roles.manage');

    // Nothing was written, and in particular the revision did not move —
    // a save that "succeeded" after quietly repairing the grid would
    // have bumped it.
    expect((await readMatrix(token)).revision).toBe(before.revision);
    expect((await readMatrix(token)).matrix['admin']).toContain('roles.manage');
  });

  it('rejects a grid that moves a locked-off cell', async () => {
    const token = await adminToken('escalator');
    const before = await readMatrix(token);

    const grid = seededGrid();
    grid['doctor'] = [...(grid['doctor'] ?? []), 'roles.manage'];

    const response = await request(harness.server)
      .put(MATRIX)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid, revision: before.revision, confirm: true });

    expect(response.status).toBe(409);

    const stored = await harness.prisma.rolePermission.count({
      where: { role: { code: 'doctor' }, permission: { code: 'roles.manage' } },
    });
    expect(stored).toBe(0);
  });

  it('refuses a grid that would orphan a capability', async () => {
    const token = await adminToken('orphansave');
    const before = await readMatrix(token);

    const grid = seededGrid();
    for (const role of PLATFORM_ROLES) {
      grid[role] = (grid[role] ?? []).filter((code) => code !== 'ai.use');
    }

    const response = await request(harness.server)
      .put(MATRIX)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid, revision: before.revision, confirm: true });

    expect(response.status).toBe(409);
    expect(errorBody(response).detail).toContain('ai.use');
    expect((await readMatrix(token)).revision).toBe(before.revision);
  });

  it('refuses a save without an explicit confirmation', async () => {
    const token = await adminToken('unconfirmed');
    const before = await readMatrix(token);

    for (const confirm of [false, undefined]) {
      const response = await request(harness.server)
        .put(MATRIX)
        .set('Authorization', `Bearer ${token}`)
        .send({ grid: seededGrid(), revision: before.revision, ...(confirm === undefined ? {} : { confirm }) });

      expect(response.status).toBe(422);
    }
  });

  it('leaves a role outside the matrix untouched', async () => {
    const token = await adminToken('nursekeeper');
    const before = await readMatrix(token);

    const nurseRowsBefore = await harness.prisma.rolePermission.count({
      where: { role: { code: 'nurse' } },
    });

    await request(harness.server)
      .put(MATRIX)
      .set('Authorization', `Bearer ${token}`)
      .send({ grid: seededGrid(), revision: before.revision, confirm: true });

    // A blanket delete would clear the bundle of any role the editor
    // does not display, and the insert would not put it back.
    expect(
      await harness.prisma.rolePermission.count({ where: { role: { code: 'nurse' } } }),
    ).toBe(nurseRowsBefore);

    await restoreMatrix(token);
  });
});

describe('POST /roles (§15.4)', () => {
  it('creates a custom role carrying the template bundle', async () => {
    const token = await adminToken('creator');
    const code = `charge-nurse-${Date.now().toString(36)}`;

    const response = await request(harness.server)
      .post(ROLES)
      .set('Authorization', `Bearer ${token}`)
      .send({ code, label: 'Charge Nurse', baseRole: 'reception' });

    expect(response.status).toBe(201);

    const role = dataOf<RoleView>(response);
    expect(role.code).toBe(code);
    expect(role.system).toBe(false);
    expect(role.baseRole).toBe('reception');
    expect(role.members).toBe(0);
    // A custom code has no column in the catalogue, which is a frontend
    // change first (see the catalogue's header).
    expect(role.inMatrix).toBe(false);

    const copied = await harness.prisma.rolePermission.count({ where: { roleId: role.id } });
    const template = await harness.prisma.rolePermission.count({
      where: { role: { code: 'reception' } },
    });
    expect(copied).toBe(template);

    await harness.prisma.role.delete({ where: { code } });
  });

  it('answers 409 for a code that already exists', async () => {
    const token = await adminToken('duplicate');

    const response = await request(harness.server)
      .post(ROLES)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'doctor', label: 'Another Doctor', baseRole: 'doctor' });

    expect(response.status).toBe(409);
  });

  it('answers 422 for an unknown base role', async () => {
    const token = await adminToken('nobase');

    const response = await request(harness.server)
      .post(ROLES)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'ghost-role', label: 'Ghost', baseRole: 'wizard' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['baseRole']).toBeDefined();
  });
});

describe('/users/{id}/permissions (§15.5)', () => {
  it('reads the bundle, the overrides and the effective set', async () => {
    const token = await adminToken('overrider');
    const subject = await seedAccount('overridden');
    const publicId = (
      await harness.prisma.user.findUniqueOrThrow({
        where: { email: subject },
        select: { publicId: true },
      })
    ).publicId;

    const before = await request(harness.server)
      .get(`/api/v1/users/${publicId}/permissions`)
      .set('Authorization', `Bearer ${token}`);

    expect(before.status).toBe(200);
    expect(dataOf<UserPermissionsView>(before).granted).toEqual([]);
    expect(dataOf<UserPermissionsView>(before).effective).toEqual(
      dataOf<UserPermissionsView>(before).fromRole,
    );

    // Take prescribing away from one doctor — the case
    // `user_permissions.allowed` exists for.
    const updated = await request(harness.server)
      .put(`/api/v1/users/${publicId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ granted: ['appointments.reassign', 'logs.view'], revoked: ['prescriptions.create'] });

    expect(updated.status).toBe(200);

    const view = dataOf<UserPermissionsView>(updated);
    expect(view.effective).toContain('appointments.reassign');
    // `logs.view` is platform administration: outside the doctor category's
    // ceiling, so the override row is stored but never effective (§2.4, §2.8).
    expect(view.effective).not.toContain('logs.view');
    expect(view.effective).not.toContain('prescriptions.create');
    // The bundle itself is untouched — this is an override, not an edit.
    expect(view.fromRole).toContain('prescriptions.create');

    // And the next token this user is issued carries the override.
    const refreshed = await tokenFor(subject);
    const session = await request(harness.server)
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${refreshed}`);

    const permissions = dataOf<{ permissions: string[] }>(session).permissions;
    expect(permissions).toContain('appointments.reassign');
    expect(permissions).not.toContain('logs.view');
    expect(permissions).not.toContain('prescriptions.create');
  });

  it('re-applies locks so an override cannot grant roles.manage', async () => {
    const token = await adminToken('lockoverride');
    const subject = await seedAccount('cannotescalate');
    const publicId = (
      await harness.prisma.user.findUniqueOrThrow({
        where: { email: subject },
        select: { publicId: true },
      })
    ).publicId;

    const response = await request(harness.server)
      .put(`/api/v1/users/${publicId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ granted: ['roles.manage'], revoked: [] });

    expect(response.status).toBe(200);

    // The row is written — the administrator asked for it — but the
    // effective set is what the guard sees, and the lock wins. A
    // response that echoed the raw override would disagree with every
    // subsequent authorization decision.
    expect(dataOf<UserPermissionsView>(response).effective).not.toContain('roles.manage');

    const refreshed = await tokenFor(subject);
    const session = await request(harness.server)
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${refreshed}`);

    expect(dataOf<{ permissions: string[] }>(session).permissions).not.toContain('roles.manage');

    // And the guard agrees: the §15 surface stays closed to them.
    const denied = await request(harness.server)
      .get(MATRIX)
      .set('Authorization', `Bearer ${refreshed}`);

    expect(denied.status).toBe(403);
  });

  it('applies a revocation on the subject’s next request, without ending their session (ADR-046)', async () => {
    const token = await adminToken('nextrequest');
    const subject = await seedAccount('nextrequestsubject');
    const subjectToken = await tokenFor(subject);
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: subject },
      select: { id: true, publicId: true },
    });

    // Warm the permission cache with the doctor's full set.
    const warm = await request(harness.server)
      .get('/api/v1/ai/conversations')
      .set('Authorization', `Bearer ${subjectToken}`);
    expect(warm.status).toBe(200);

    const updated = await request(harness.server)
      .put(`/api/v1/users/${user.publicId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ granted: [], revoked: ['ai.use'] });
    expect(updated.status).toBe(200);

    // Same token, next request: the capability is gone (the token's
    // `permissions` claim still lists it — claims are never trusted).
    const after = await request(harness.server)
      .get('/api/v1/ai/conversations')
      .set('Authorization', `Bearer ${subjectToken}`);
    expect(after.status).toBe(403);

    // An ordinary permission change does not revoke the session.
    const session = await request(harness.server)
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${subjectToken}`);
    expect(session.status).toBe(200);
    await expect(
      harness.prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).resolves.toBeGreaterThan(0);
  });

  it('rejects a body that both grants and revokes a capability', async () => {
    const token = await adminToken('contradiction');
    const subject = await seedAccount('confused');
    const publicId = (
      await harness.prisma.user.findUniqueOrThrow({
        where: { email: subject },
        select: { publicId: true },
      })
    ).publicId;

    const response = await request(harness.server)
      .put(`/api/v1/users/${publicId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ granted: ['logs.view'], revoked: ['logs.view'] });

    expect(response.status).toBe(422);
  });

  it('answers 404 for an unknown user', async () => {
    const token = await adminToken('ghostuser');

    const response = await request(harness.server)
      .get('/api/v1/users/usr_nobody/permissions')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });
});
