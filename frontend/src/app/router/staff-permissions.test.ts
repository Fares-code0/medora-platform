import { describe, expect, it } from 'vitest';

import { DEFAULT_PERMISSION_MATRIX } from '@/features/admin/permissions';
import {
  LABORATORY_PERMISSIONS,
  PHARMACY_PERMISSIONS,
  RECEPTION_PERMISSIONS,
} from '@/features/auth/mock/users';

/**
 * The demo staff accounts hold exactly the seeded bundle the admin matrix
 * shows (DEC-006a), which is the backend's `SEEDED_MATRIX`. If the demo gave
 * a role more, a demo workspace would offer what the API refuses; if less, it
 * would hide what the API allows.
 *
 * Here rather than beside either list: it reads two features, and only the
 * app layer may.
 */

describe('staff permission bundles', () => {
  it.each([
    ['reception', RECEPTION_PERMISSIONS],
    ['laboratory', LABORATORY_PERMISSIONS],
    ['pharmacy', PHARMACY_PERMISSIONS],
  ] as const)('%s matches the seeded matrix', (role, demo) => {
    expect([...demo].sort()).toEqual([...DEFAULT_PERMISSION_MATRIX[role]].sort());
  });

  it('gives no staff role the identity reveal or any prescription capability', () => {
    for (const bundle of [RECEPTION_PERMISSIONS, LABORATORY_PERMISSIONS, PHARMACY_PERMISSIONS]) {
      expect(bundle).not.toContain('patients.revealIdentity');
      expect(bundle).not.toContain('prescriptions.create');
    }
  });
});
