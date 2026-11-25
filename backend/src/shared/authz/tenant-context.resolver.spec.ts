import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { TenantContextResolver } from './tenant-context.resolver';

/**
 * F-15: a request's context comes from the caller's own records and is never
 * `system` — whatever their role, and whatever their staffing looks like.
 */
function resolverWith(answers: {
  admin: { kind: 'platform' } | { kind: 'hospital'; hospitalId: string } | { kind: 'none' };
  doctor: { kind: 'hospital'; hospitalId: string } | { kind: 'unresolved' };
  patient: { id: string } | null;
  affiliation: { hospitalId: string } | null;
}): TenantContextResolver {
  const config = { databaseTenantContext: true } as never;
  const scopes = { scopeOf: () => Promise.resolve(answers.admin) } as never;
  const contexts = { forRequest: () => Promise.resolve(answers.doctor) } as never;
  const prisma = {
    db: {
      patient: { findFirst: () => Promise.resolve(answers.patient) },
      hospitalStaffAffiliation: { findFirst: () => Promise.resolve(answers.affiliation) },
    },
  } as never;
  return new TenantContextResolver(config, scopes, contexts, prisma);
}

const user = (role: string): AuthenticatedUser =>
  ({ id: 'u-1', role, publicId: 'usr_1', permissions: [], sessionId: 's-1' });

describe('TenantContextResolver (F-15)', () => {
  const variants = [
    { admin: { kind: 'platform' }, doctor: { kind: 'hospital', hospitalId: 'h' }, patient: { id: 'p' }, affiliation: { hospitalId: 'h' } },
    { admin: { kind: 'hospital', hospitalId: 'h' }, doctor: { kind: 'unresolved' }, patient: null, affiliation: null },
    { admin: { kind: 'none' }, doctor: { kind: 'unresolved' }, patient: null, affiliation: null },
  ] as const;

  it.each(['admin', 'doctor', 'patient', 'reception', 'laboratory', 'pharmacy', 'nurse', 'custom_role', ''])(
    'never resolves a %s caller to system scope',
    async (role) => {
      for (const answers of variants) {
        const context = await resolverWith(answers).resolve(user(role));
        expect(context?.scope).not.toBe('system');
      }
    },
  );

  it('derives the hospital from the server’s records, not from the caller', async () => {
    const context = await resolverWith(variants[0]).resolve(user('doctor'));
    expect(context).toEqual({ scope: 'hospital', hospitalId: 'h', userId: 'u-1' });
  });
});
