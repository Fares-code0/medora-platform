import { describe, expect, it } from 'vitest';

import { CLINIC_DOCTORS } from '@/features/shared-domain/clinic-operations/store';

import { seededUsers, toSessionUser } from './users';

/**
 * The join D-27b could not make in code (§3.3).
 *
 * `shared-domain` may not import `features/auth`, so `CLINIC_DOCTORS` — the
 * list a check-in form offers, and the ids a queue entry is attributed to —
 * is seeded by hand against the accounts the auth mock issues. Two hand-kept
 * lists drift, so this test is the thing that stops them: it lives in `auth`,
 * which may import both.
 *
 * The real fix is a backend one — one staff record, one account, one link —
 * and `docs/handoff/clinic-isolation.md` asks for it.
 */

describe('CLINIC_DOCTORS agrees with the seeded accounts', () => {
  it('names only real doctor accounts', () => {
    const doctorIds = seededUsers.filter((u) => u.role === 'doctor').map((u) => u.id);

    for (const doctor of CLINIC_DOCTORS) {
      expect(doctorIds).toContain(doctor.id);
    }
  });

  it('spells each doctor’s name the way their account does', () => {
    for (const doctor of CLINIC_DOCTORS) {
      const account = seededUsers.find((u) => u.id === doctor.id);
      expect(account?.name).toBe(doctor.name);
    }
  });

  it('names only doctors who belong to the clinic those rows are seeded in', () => {
    for (const doctor of CLINIC_DOCTORS) {
      const account = seededUsers.find((u) => u.id === doctor.id);
      expect(account?.clinicId).toBe('clinic-meadowbrook');
    }
  });
});

describe('the session carries the clinic (D-27b)', () => {
  it('gives every doctor account a clinic', () => {
    for (const record of seededUsers.filter((u) => u.role === 'doctor')) {
      expect(toSessionUser(record).clinicId).toBeDefined();
    }
  });

  it('leaves an admin unscoped rather than scoped to nothing', () => {
    /*
     * `undefined` means "spans every clinic"; `''` would mean "belongs to a
     * clinic named nothing" and would show an administrator an empty app.
     * The distinction is the one `ClinicScope` is built around.
     */
    for (const record of seededUsers.filter((u) => u.role === 'admin')) {
      expect(toSessionUser(record).clinicId).toBeUndefined();
    }
  });
});
