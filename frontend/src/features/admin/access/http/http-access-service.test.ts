import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { DEFAULT_PERMISSION_MATRIX, isPermissionConflict } from '../../permissions';

import { httpAccessService, toAccessUser } from './http-access-service';

/** Users, roles and staff invitations over HTTP (FE-10.10). */

afterEach(() => {
  vi.unstubAllGlobals();
});

function userView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usr_doctor',
    name: 'Dr. Amelia Chen',
    email: 'doctor@medora.health',
    role: 'doctor',
    active: true,
    lastActiveAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function matrixView(overrides: Record<string, unknown> = {}) {
  return {
    matrix: DEFAULT_PERMISSION_MATRIX,
    revision: 4,
    updatedAt: '2026-10-01T09:00:00.000Z',
    updatedBy: null,
    ...overrides,
  };
}

describe('toAccessUser', () => {
  it('keeps any role code, patients included', () => {
    expect(toAccessUser(userView({ role: 'patient' }))).toEqual({
      id: 'usr_doctor',
      name: 'Dr. Amelia Chen',
      email: 'doctor@medora.health',
      role: 'patient',
      active: true,
      lastActiveAt: null,
    });
  });
});

describe('users', () => {
  it('searches and filters on the server', async () => {
    const { requests } = stubApi({ 'GET /admin/users': () => pageOf([userView()]) });
    await httpAccessService.listUsers({ search: ' chen ', role: 'doctor' });
    expect(requests[0]?.query.get('q')).toBe('chen');
    expect(requests[0]?.query.get('role')).toBe('doctor');

    await httpAccessService.listUsers({ search: '', role: 'all' });
    expect(requests[1]?.query.has('q')).toBe(false);
    expect(requests[1]?.query.has('role')).toBe(false);
  });

  it('patches role and active, and answers with the server’s row', async () => {
    const { requests } = stubApi({
      'PATCH /admin/users/usr_doctor': () => envelope(userView({ active: false })),
    });
    const updated = await httpAccessService.updateUser('usr_doctor', { active: false });
    expect(requests[0]?.body).toEqual({ active: false });
    expect(updated.active).toBe(false);
  });

  it('passes the second-factor refusal through with its code', async () => {
    stubApi({
      'PATCH /admin/users/usr_doctor': () =>
        json(
          {
            code: 'two_factor_required',
            message: 'Conflict',
            detail: 'The admin role requires an enrolled second factor.',
          },
          409,
        ),
    });
    await expect(
      httpAccessService.updateUser('usr_doctor', { role: 'admin' }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'two_factor_required' });
  });

  it('passes a self-edit refusal through as forbidden', async () => {
    stubApi({ 'PATCH /admin/users/usr_admin': () => json({ code: 'forbidden' }, 403) });
    await expect(
      httpAccessService.updateUser('usr_admin', { active: false }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('the permission matrix', () => {
  it('reads the grid, and names the baseline when nobody saved it', async () => {
    stubApi({ 'GET /roles/matrix': () => envelope(matrixView()) });
    await expect(httpAccessService.getMatrix()).resolves.toMatchObject({
      revision: 4,
      updatedBy: 'Platform baseline',
    });
  });

  it('names the last editor from their handle, and falls back to the handle', async () => {
    stubApi({
      'GET /roles/matrix': () => envelope(matrixView({ updatedBy: 'usr_admin' })),
      'GET /admin/users/usr_admin': () =>
        envelope(userView({ id: 'usr_admin', name: 'Marcus Reed', role: 'admin' })),
    });
    await expect(httpAccessService.getMatrix()).resolves.toMatchObject({
      updatedBy: 'Marcus Reed',
    });

    stubApi({
      'GET /roles/matrix': () => envelope(matrixView({ updatedBy: 'usr_gone' })),
      'GET /admin/users/usr_gone': () => json({ code: 'not_found' }, 404),
    });
    await expect(httpAccessService.getMatrix()).resolves.toMatchObject({ updatedBy: 'usr_gone' });
  });

  it('counts active members of the matrix roles only', async () => {
    stubApi({
      'GET /roles': () =>
        envelope([
          { code: 'admin', activeMembers: 1 },
          { code: 'doctor', activeMembers: 5 },
          { code: 'patient', activeMembers: 40 },
        ]),
    });
    await expect(httpAccessService.roleCounts()).resolves.toEqual({
      admin: 1,
      doctor: 5,
      reception: 0,
      laboratory: 0,
      pharmacy: 0,
    });
  });

  it('saves the whole grid with the revision it was opened on, confirmed', async () => {
    const { requests } = stubApi({
      'PUT /roles/matrix': () => envelope(matrixView({ revision: 5 })),
    });
    const saved = await httpAccessService.saveMatrix({
      matrix: DEFAULT_PERMISSION_MATRIX,
      baseRevision: 4,
      actor: 'A',
    });
    expect(requests[0]?.body).toEqual({
      grid: DEFAULT_PERMISSION_MATRIX,
      revision: 4,
      confirm: true,
    });
    expect(saved.revision).toBe(5);
  });

  it('turns a stale-revision 409 into the merge dialog’s conflict', async () => {
    stubApi({
      'PUT /roles/matrix': () =>
        json(
          {
            code: 'conflict',
            message: 'The permission matrix changed since this editor was opened',
            detail: JSON.stringify({ current: matrixView({ revision: 6 }), yours: [], theirs: [] }),
          },
          409,
        ),
    });
    const failure: unknown = await httpAccessService
      .saveMatrix({ matrix: DEFAULT_PERMISSION_MATRIX, baseRevision: 4, actor: 'A' })
      .catch((error: unknown) => error);
    expect(isPermissionConflict(failure)).toBe(true);
    if (isPermissionConflict(failure)) expect(failure.current.revision).toBe(6);
  });

  it('passes a lock or orphan 409 through as the server worded it', async () => {
    stubApi({
      'PUT /roles/matrix': () =>
        json({ code: 'conflict', detail: 'No role would hold: logs.export' }, 409),
    });
    await expect(
      httpAccessService.saveMatrix({
        matrix: DEFAULT_PERMISSION_MATRIX,
        baseRevision: 4,
        actor: 'A',
      }),
    ).rejects.toMatchObject({ kind: 'conflict', detail: 'No role would hold: logs.export' });
  });

  it('has no reset route, and says so', async () => {
    expect(httpAccessService.capabilities.resetMatrix).toBe(false);
    await expect(httpAccessService.resetMatrix('A')).rejects.toMatchObject({
      code: 'not_connected',
    });
  });
});

describe('staff invitations', () => {
  it('posts the address and role, and reads back the expiry', async () => {
    const { requests } = stubApi({
      'POST /auth/admin-invitations': () =>
        envelope({
          email: 'new.admin@medora.health',
          role: 'admin',
          expiresAt: '2026-10-08T12:00:00.000Z',
        }),
    });
    await expect(
      httpAccessService.invite({ email: ' new.admin@medora.health ', role: 'admin' }),
    ).resolves.toEqual({
      email: 'new.admin@medora.health',
      role: 'admin',
      expiresAt: '2026-10-08T12:00:00.000Z',
    });
    expect(requests[0]?.body).toEqual({ email: 'new.admin@medora.health', role: 'admin' });
  });

  it('passes the duplicate-address conflict and validation refusals through', async () => {
    stubApi({
      'POST /auth/admin-invitations': (request) =>
        (request.body as { email: string }).email === 'taken@medora.health'
          ? json(
              {
                code: 'email_taken',
                message: 'Email already registered',
                detail: 'An account with this email already exists',
              },
              409,
            )
          : json(
              {
                code: 'validation_failed',
                fieldErrors: { email: ['Enter a valid email address'] },
              },
              422,
            ),
    });
    await expect(
      httpAccessService.invite({ email: 'taken@medora.health', role: 'reception' }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'email_taken' });
    await expect(
      httpAccessService.invite({ email: 'nope', role: 'reception' }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('reports a caller without the roles permission as forbidden', async () => {
    stubApi({ 'POST /auth/admin-invitations': () => json({ code: 'forbidden' }, 403) });
    await expect(
      httpAccessService.invite({ email: 'a@medora.health', role: 'pharmacy' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('the matrix dry run (API §15.3)', () => {
  const grant = { role: 'reception', capability: 'records.view', next: true, phi: true };

  function previewView(overrides: Record<string, unknown> = {}) {
    return {
      changes: [grant, { role: 'pharmacy', capability: 'labs.review', next: false, phi: false }],
      roles: [
        { role: 'reception', grants: 1, revokes: 0, activeUsers: 3 },
        { role: 'pharmacy', grants: 0, revokes: 1, activeUsers: 2 },
      ],
      affectedUsers: 5,
      phiGrants: [grant],
      orphaned: [],
      ...overrides,
    };
  }

  it('sends the whole grid and reads the server’s answer, not a local diff', async () => {
    const { requests } = stubApi({
      'POST /roles/matrix/preview': () => envelope(previewView({ orphaned: ['logs.export'] })),
    });

    const preview = await httpAccessService.previewMatrix(DEFAULT_PERMISSION_MATRIX);

    expect(requests[0]?.body).toEqual({ grid: DEFAULT_PERMISSION_MATRIX });
    expect(
      preview.changes.map((change) => [change.role, change.capability.id, change.next]),
    ).toEqual([
      ['reception', 'records.view', true],
      ['pharmacy', 'labs.review', false],
    ]);
    expect(preview.roles).toEqual([
      { role: 'reception', grants: 1, revokes: 0, users: 3 },
      { role: 'pharmacy', grants: 0, revokes: 1, users: 2 },
    ]);
    expect(preview.users).toBe(5);
    expect(preview.phiGrants.map((change) => change.capability.label)).toEqual([
      'View medical records',
    ]);
    expect(preview.orphaned.map((capability) => capability.id)).toEqual(['logs.export']);
  });

  it('refuses an answer naming a capability or a role it does not know', async () => {
    stubApi({
      'POST /roles/matrix/preview': () =>
        envelope(previewView({ changes: [{ ...grant, capability: 'billing.refund' }] })),
    });
    await expect(httpAccessService.previewMatrix(DEFAULT_PERMISSION_MATRIX)).rejects.toMatchObject({
      code: 'malformed_response',
    });

    stubApi({
      'POST /roles/matrix/preview': () =>
        envelope(
          previewView({
            roles: [{ role: 'ward_clerk', grants: 1, revokes: 0, activeUsers: 1 }],
          }),
        ),
    });
    await expect(httpAccessService.previewMatrix(DEFAULT_PERMISSION_MATRIX)).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });
});
