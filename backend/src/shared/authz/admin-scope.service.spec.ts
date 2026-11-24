import { describe, expect, it, vi } from 'vitest';

import {
  AdminScopeService,
  hospitalFilterOf,
  scopeFromFacts,
  type AdminScopeFacts,
  type AdminScopeRepository,
} from './admin-scope.service';

const A = { hospitalId: 'hospital-a', hospitalName: 'A Hospital', hospitalActive: true };
const B = { hospitalId: 'hospital-b', hospitalName: 'B Hospital', hospitalActive: true };

function facts(partial: Partial<AdminScopeFacts>): AdminScopeFacts {
  return { platformAdmin: false, hospitalAdminAssignments: [], ...partial };
}

describe('scopeFromFacts (S5 decision table)', () => {
  it('is platform only for an explicit, live Platform Admin grant', () => {
    expect(scopeFromFacts(facts({ platformAdmin: true }))).toEqual({ kind: 'platform' });
  });

  it('never infers platform scope from the admin role alone (M-13)', () => {
    expect(scopeFromFacts(facts({}))).toEqual({ kind: 'none', reason: 'not_mapped' });
  });

  it('is the one hospital of a Hospital Admin', () => {
    expect(scopeFromFacts(facts({ hospitalAdminAssignments: [A] }))).toEqual({
      kind: 'hospital',
      hospitalId: 'hospital-a',
      hospitalName: 'A Hospital',
    });
  });

  it('collapses duplicate assignments at the same hospital', () => {
    expect(scopeFromFacts(facts({ hospitalAdminAssignments: [A, A] })).kind).toBe('hospital');
  });

  it('refuses two hospitals (no switching), even when one is inactive', () => {
    expect(scopeFromFacts(facts({ hospitalAdminAssignments: [A, B] }))).toEqual({
      kind: 'none',
      reason: 'ambiguous_hospital_admin',
    });
    expect(
      scopeFromFacts(facts({ hospitalAdminAssignments: [A, { ...B, hospitalActive: false }] })),
    ).toEqual({ kind: 'none', reason: 'ambiguous_hospital_admin' });
  });

  it('refuses a single assignment at an inactive hospital', () => {
    expect(
      scopeFromFacts(facts({ hospitalAdminAssignments: [{ ...A, hospitalActive: false }] })),
    ).toEqual({ kind: 'none', reason: 'hospital_not_active' });
  });

  it('honours neither designation when both exist', () => {
    expect(scopeFromFacts(facts({ platformAdmin: true, hospitalAdminAssignments: [A] }))).toEqual({
      kind: 'none',
      reason: 'conflicting_designations',
    });
  });
});

describe('hospitalFilterOf', () => {
  it('is null only for platform scope', () => {
    expect(hospitalFilterOf({ kind: 'platform' })).toBeNull();
    expect(hospitalFilterOf({ kind: 'hospital', hospitalId: 'h', hospitalName: 'H' })).toBe('h');
  });
});

describe('AdminScopeService', () => {
  function service(result: AdminScopeFacts | Error) {
    const facts = vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    );
    const repository: AdminScopeRepository = { facts };
    return { scopes: new AdminScopeService(repository), facts };
  }

  it('does not read the database for a non-admin role', async () => {
    const { scopes, facts } = service({ platformAdmin: true, hospitalAdminAssignments: [] });
    await expect(scopes.resolve({ id: 'u', role: 'doctor' })).resolves.toEqual({
      kind: 'none',
      reason: 'not_admin_role',
    });
    expect(facts).not.toHaveBeenCalled();
  });

  it('resolves an administrator from the repository facts', async () => {
    const { scopes, facts } = service({ platformAdmin: true, hospitalAdminAssignments: [] });
    await expect(scopes.forRequest({ id: 'u', role: 'admin' })).resolves.toEqual({
      kind: 'platform',
    });
    expect(facts).toHaveBeenCalledWith('u');
  });

  it('fails closed when the lookup fails', async () => {
    const { scopes } = service(new Error('database down'));
    await expect(scopes.forRequest({ id: 'u', role: 'admin' })).resolves.toEqual({
      kind: 'none',
      reason: 'resolution_unavailable',
    });
  });
});
