import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PERMISSION_MATRIX,
  isPermissionConflict,
  setCapability,
  type PermissionMatrix,
} from '../permissions';

import { adminSettingsApi, DEFAULT_ADMIN_SETTINGS } from './admin-settings.api';

/**
 * Permission-matrix persistence (ADM-09).
 *
 * "The grid renders" is not the acceptance criterion — the criterion is that
 * a saved change is still there after a full reload, and that two
 * administrators editing at once cannot silently overwrite each other. Both
 * are pinned here against the same localStorage-backed service the UI uses.
 */

const STORAGE_KEY = 'medora.admin.settings.v1';

/** A reload is exactly this: throw away every in-memory value and read again. */
function reload() {
  return adminSettingsApi.getSettings();
}

async function save(matrix: PermissionMatrix, baseRevision: number, actor = 'Marcus Reed') {
  return adminSettingsApi.savePermissions({ matrix, baseRevision, actor });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('defaults', () => {
  it('serves the seeded matrix when nothing is stored', async () => {
    const document = await reload();

    expect(document.permissions.matrix).toEqual(DEFAULT_PERMISSION_MATRIX);
    expect(document.permissions.revision).toBe(1);
  });

  it('carries the matrix on the document the other settings panels read', () => {
    expect(DEFAULT_ADMIN_SETTINGS.permissions.matrix).toEqual(DEFAULT_PERMISSION_MATRIX);
  });
});

describe('savePermissions', () => {
  it('persists a granted capability across a reload', async () => {
    const draft = setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true);

    await save(draft, 1);

    const afterReload = await reload();
    expect(afterReload.permissions.matrix.pharmacy).toContain('labs.review');
  });

  it('persists a revoked capability across a reload', async () => {
    const draft = setCapability(DEFAULT_PERMISSION_MATRIX, 'doctor', 'ai.use', false);

    await save(draft, 1);

    const afterReload = await reload();
    expect(afterReload.permissions.matrix.doctor).not.toContain('ai.use');
  });

  it('really writes to storage rather than to an in-memory cache', async () => {
    await save(setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true), 1);

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(String(raw)).toContain('labs.review');
  });

  it('returns the full patched document so the cache can be seeded', async () => {
    const document = await save(
      setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true),
      1,
    );

    expect(document.users).toEqual(DEFAULT_ADMIN_SETTINGS.users);
    expect(document.general).toEqual(DEFAULT_ADMIN_SETTINGS.general);
    expect(document.permissions.matrix.pharmacy).toContain('labs.review');
  });

  it('bumps the revision and stamps the actor', async () => {
    const document = await save(DEFAULT_PERMISSION_MATRIX, 1, 'Marcus Reed');

    expect(document.permissions.revision).toBe(2);
    expect(document.permissions.updatedBy).toBe('Marcus Reed');
  });

  it('re-applies the safety locks to whatever it is handed', async () => {
    // A caller that bypassed the disabled switch entirely.
    const tampered: PermissionMatrix = {
      ...DEFAULT_PERMISSION_MATRIX,
      admin: DEFAULT_PERMISSION_MATRIX.admin.filter((id) => id !== 'roles.manage'),
      reception: [...DEFAULT_PERMISSION_MATRIX.reception, 'prescriptions.create'],
    };

    const document = await save(tampered, 1);

    expect(document.permissions.matrix.admin).toContain('roles.manage');
    expect(document.permissions.matrix.reception).not.toContain('prescriptions.create');
  });

  it('leaves the rest of the settings document alone', async () => {
    await adminSettingsApi.saveSection('branding', {
      ...DEFAULT_ADMIN_SETTINGS.branding,
      productName: 'Medora Health',
    });

    await save(setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true), 1);

    const afterReload = await reload();
    expect(afterReload.branding.productName).toBe('Medora Health');
  });
});

describe('concurrent edits', () => {
  it('rejects a save based on a stale revision', async () => {
    // Another administrator saves first.
    await save(
      setCapability(DEFAULT_PERMISSION_MATRIX, 'reception', 'labs.review', true),
      1,
      'Ana',
    );

    // This editor still holds revision 1.
    const mine = setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true);
    await expect(save(mine, 1)).rejects.toSatisfy(isPermissionConflict);
  });

  it('hands the current state back so both change sets can be shown', async () => {
    await save(
      setCapability(DEFAULT_PERMISSION_MATRIX, 'reception', 'labs.review', true),
      1,
      'Ana',
    );

    const error = await save(DEFAULT_PERMISSION_MATRIX, 1).catch((thrown: unknown) => thrown);

    expect(isPermissionConflict(error)).toBe(true);
    if (!isPermissionConflict(error)) throw new Error('expected a conflict');
    expect(error.current.revision).toBe(2);
    expect(error.current.updatedBy).toBe('Ana');
    expect(error.current.matrix.reception).toContain('labs.review');
  });

  it('writes nothing when it conflicts', async () => {
    await save(
      setCapability(DEFAULT_PERMISSION_MATRIX, 'reception', 'labs.review', true),
      1,
      'Ana',
    );

    await save(setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true), 1).catch(
      () => undefined,
    );

    const afterReload = await reload();
    expect(afterReload.permissions.revision).toBe(2);
    expect(afterReload.permissions.matrix.pharmacy).not.toContain('labs.review');
  });

  it('accepts the same save once it is rebased on the current revision', async () => {
    await save(
      setCapability(DEFAULT_PERMISSION_MATRIX, 'reception', 'labs.review', true),
      1,
      'Ana',
    );

    const document = await save(
      setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true),
      2,
    );

    expect(document.permissions.revision).toBe(3);
    expect(document.permissions.matrix.pharmacy).toContain('labs.review');
  });
});

describe('resetPermissions', () => {
  it('restores the baseline and keeps the revision moving forward', async () => {
    await save(setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true), 1);

    const document = await adminSettingsApi.resetPermissions('Marcus Reed');

    expect(document.permissions.matrix).toEqual(DEFAULT_PERMISSION_MATRIX);
    expect(document.permissions.revision).toBe(3);
    await expect(reload().then((d) => d.permissions.matrix)).resolves.toEqual(
      DEFAULT_PERMISSION_MATRIX,
    );
  });
});

describe('stored documents from an older build', () => {
  it('repairs a document that predates the matrix instead of leaving a hole', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ general: DEFAULT_ADMIN_SETTINGS.general }),
    );

    const document = await reload();

    expect(document.permissions.matrix).toEqual(DEFAULT_PERMISSION_MATRIX);
    expect(document.permissions.revision).toBe(1);
  });

  it('repairs a stored matrix that violates a lock added since', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        permissions: {
          revision: 4,
          updatedAt: '2026-08-01T10:00:00Z',
          updatedBy: 'Ana',
          matrix: { ...DEFAULT_PERMISSION_MATRIX, reception: ['prescriptions.create'] },
        },
      }),
    );

    const document = await reload();

    expect(document.permissions.matrix.reception).not.toContain('prescriptions.create');
    expect(document.permissions.revision).toBe(4);
  });
});
