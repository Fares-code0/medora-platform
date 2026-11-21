/**
 * The seed agrees with the catalogue (RM M5.1, M6.2, M7.1).
 *
 * The 22 capabilities are written down three times: the frontend union
 * (`types/auth`), this kernel's catalogue, and `prisma/seed/permissions.ts`.
 * `permission-catalogue.spec.ts` binds the first two together. This binds
 * the third, and it is arguably the one that matters most in production:
 * the seed is what populates the `permissions`, `roles` and
 * `role_permissions` rows that M6's live `PermissionService` reads, so a
 * seed that drifted from the catalogue would mean the tokens the server
 * issues and the capabilities its guards check had quietly stopped
 * describing the same platform.
 *
 * Nothing guarded that until this file. The seed's own
 * `assertBundlesReferenceKnownCodes` checks bundles against the seed's
 * *own* permission list — which is exactly the kind of test that passes
 * just as happily when both halves are wrong together.
 */

import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS as SEED_PERMISSIONS,
  ROLES as SEED_ROLES,
} from '../../../prisma/seed/permissions';
import {
  PERMISSIONS,
  PLATFORM_ROLES,
  SEEDED_MATRIX,
  bundleFor,
  isPlatformRole,
} from './permission-catalogue';

describe('seed ↔ catalogue: capabilities', () => {
  it('seeds exactly the 22 capabilities the catalogue declares', () => {
    expect([...SEED_PERMISSIONS.map((p) => p.code)].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('seeds no capability twice', () => {
    const codes = SEED_PERMISSIONS.map((p) => p.code);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('seed ↔ catalogue: role bundles', () => {
  it('gives every matrix role the bundle the catalogue seeds', () => {
    for (const role of PLATFORM_ROLES) {
      const seeded = SEED_ROLES.find((r) => r.code === role);

      expect(seeded, `${role} is missing from the seed`).toBeDefined();
      expect([...(seeded?.permissions ?? [])].sort(), `${role} bundle`).toEqual(
        [...SEEDED_MATRIX[role]].sort(),
      );
    }
  });

  it('seeds no role the catalogue cannot resolve a bundle for', () => {
    // `bundleFor` is total — a role with no matrix column resolves to an
    // empty bundle rather than to `undefined`. This asserts that every
    // seeded role actually goes through that path without surprise.
    for (const seeded of SEED_ROLES) {
      const resolved = bundleFor(seeded.code);

      if (isPlatformRole(seeded.code)) {
        expect([...resolved].sort(), seeded.code).toEqual([...seeded.permissions].sort());
      } else {
        expect(resolved, `${seeded.code} has no matrix column`).toEqual([]);
      }
    }
  });
});

describe('the roles table is wider than the matrix, deliberately', () => {
  // This is the shape of the disagreement, pinned so that a future edit
  // to either side has to come past a failing test rather than through
  // a silent divergence.
  it('seeds exactly two roles with no matrix column: nurse and patient', () => {
    const bundleless = SEED_ROLES.filter((r) => !isPlatformRole(r.code)).map((r) => r.code);

    expect([...bundleless].sort()).toEqual(['nurse', 'patient']);
  });

  it('grants nurse nothing', () => {
    // ADR-017 §6 puts the wider staff vocabulary in `roles`; the ADM-09
    // matrix has no nurse column, so no source says what a nurse may do.
    // An empty bundle is the fail-closed reading, and it is what both the
    // seed and `bundleFor` implement.
    const nurse = SEED_ROLES.find((r) => r.code === 'nurse');

    expect(nurse?.permissions).toEqual([]);
    expect(bundleFor('nurse')).toEqual([]);
  });

  it('grants patient nothing, which is the design and not a placeholder', () => {
    // ADR-030 §6. `nurse` holds nothing because no source says what a
    // nurse may do; `patient` holds nothing because there is nothing in
    // this vocabulary a patient should hold. The 22 capabilities are
    // clinician capabilities an administrator grants to staff.
    //
    // The zero bundle is load-bearing rather than incidental: it is what
    // closes every `@Can(...)` route in the platform to patients without
    // a line of code. Patient authorization is ownership-based instead,
    // through `PatientSelfScopeService`.
    const patient = SEED_ROLES.find((r) => r.code === 'patient');

    expect(patient?.permissions).toEqual([]);
    expect(bundleFor('patient')).toEqual([]);
  });

  it('keeps patient out of the permission matrix (ADR-030 §6)', () => {
    // The guard on the mistake this ADR exists to prevent. `PLATFORM_ROLES`
    // is a transcription of `frontend/src/features/admin/permissions.ts`
    // and the parity spec above binds the two, so adding a `patient`
    // column here would fail against the other tree — and would put every
    // patient into the clinic's staff-permission editor as a grantable
    // principal. A role in `roles` is not a column in the matrix.
    expect(isPlatformRole('patient')).toBe(false);
    expect(PLATFORM_ROLES).not.toContain('patient');
  });

  it('does not seed the alias spellings as separate roles', () => {
    // `receptionist` is the `StaffRole` spelling of `reception` and
    // `pharmacist` the contact spelling of `pharmacy` — aliases of one
    // role each (DB §14.5-7), not additional roles. Seeding either would
    // create a second role holding nothing.
    //
    // `patient` was on this list until ADR-030. It is now a seeded role,
    // and its removal from here is the deliberate, greppable signal that
    // ADR-018 §3 was amended by a recorded owner decision rather than
    // eroded by a commit.
    const codes = SEED_ROLES.map((r) => r.code);

    expect(codes).not.toContain('receptionist');
    expect(codes).not.toContain('pharmacist');
  });
});
