/**
 * Parity between this kernel's vocabulary and the frontend's (RM M7.1).
 *
 * `permission-catalogue.ts` is a transcription of two frontend modules.
 * Transcriptions are correct on the day they are written and wrong some
 * months later, when one side changes and nobody remembers the other
 * exists. This spec is the thing that remembers: it loads the frontend
 * modules and compares.
 *
 * **On the import.** The frontend sources are outside the backend's
 * `rootDir`, and `permissions.ts` imports `@/types/auth` — a specifier
 * that resolves against the *backend's* `@` alias if TypeScript is
 * allowed to see it. A static import therefore fails `tsc` twice
 * (TS6059, TS2307) even though Vitest runs it happily. Building the
 * specifier at runtime keeps TypeScript out of the other tree entirely;
 * the interfaces below restore the typing that the single cast costs.
 *
 * SWC erases the `import type` before resolution, so nothing of the SPA
 * is dragged in — these two modules load alone.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CAPABILITIES,
  PERMISSIONS,
  PLATFORM_ROLES,
  SEEDED_MATRIX,
  type CapabilityMeta,
  type Permission,
  type PlatformRole,
} from './permission-catalogue';

const FRONTEND_SRC = resolve(__dirname, '../../../../frontend/src');

/** The shape this spec needs from `features/admin/permissions.ts`. */
interface FrontendPermissionsModule {
  readonly PLATFORM_ROLES: readonly string[];
  readonly PERMISSION_CAPABILITIES: readonly {
    readonly id: string;
    readonly group: string;
    readonly phi?: boolean;
    readonly lockedOn?: readonly string[];
    readonly lockedOff?: readonly string[];
  }[];
  readonly DEFAULT_PERMISSION_MATRIX: Readonly<Record<string, readonly string[]>>;
}

async function loadFrontendPermissions(): Promise<FrontendPermissionsModule> {
  return (await import(
    `${FRONTEND_SRC}/features/admin/permissions.ts`
  )) as FrontendPermissionsModule;
}

/** Normalises an optional lock list so `undefined` and `[]` compare equal. */
function locks(value: readonly string[] | undefined): readonly string[] {
  return [...(value ?? [])].sort();
}

describe('permission catalogue parity with the frontend', () => {
  it('carries the same 22 capabilities, in the same order', async () => {
    const frontend = await loadFrontendPermissions();

    expect(PERMISSIONS).toEqual(frontend.PERMISSION_CAPABILITIES.map((c) => c.id));
    // Stated separately: the roadmap's M5.1 verify step turns on the count
    // ("a 23rd permission cannot exist"), so a change of size should read
    // as its own failure rather than as an ordering diff.
    expect(PERMISSIONS).toHaveLength(22);
  });

  it('carries the same five platform roles', async () => {
    const frontend = await loadFrontendPermissions();

    expect(PLATFORM_ROLES).toEqual(frontend.PLATFORM_ROLES);
  });

  it('agrees on the group, PHI flag and locks of every capability', async () => {
    const frontend = await loadFrontendPermissions();
    const frontendById = new Map(frontend.PERMISSION_CAPABILITIES.map((c) => [c.id, c]));

    for (const capability of PERMISSION_CAPABILITIES) {
      const counterpart = frontendById.get(capability.id);
      expect(counterpart, `${capability.id} is missing from the frontend`).toBeDefined();
      if (counterpart === undefined) continue;

      expect(capability.group, `${capability.id} group`).toBe(counterpart.group);
      expect(capability.phi === true, `${capability.id} phi`).toBe(counterpart.phi === true);
      expect(locks(capability.lockedOn), `${capability.id} lockedOn`).toEqual(
        locks(counterpart.lockedOn),
      );
      expect(locks(capability.lockedOff), `${capability.id} lockedOff`).toEqual(
        locks(counterpart.lockedOff),
      );
    }
  });

  it('seeds every role with the bundle the frontend seeds', async () => {
    const frontend = await loadFrontendPermissions();

    for (const role of PLATFORM_ROLES) {
      expect([...SEEDED_MATRIX[role]].sort(), `${role} bundle`).toEqual(
        [...(frontend.DEFAULT_PERMISSION_MATRIX[role] ?? [])].sort(),
      );
    }
  });

  it('matches the `Permission` union declared in types/auth', async () => {
    // A second frontend file, and the one the roadmap actually names as
    // the vocabulary. `permissions.ts` types its ids against this union,
    // so the two cannot disagree — but that is an argument for checking
    // it, not for assuming it.
    const authTypes = resolve(FRONTEND_SRC, 'types/auth/index.ts');
    const source = await import('node:fs/promises').then((fs) => fs.readFile(authTypes, 'utf8'));

    // The union is declared as `| 'patients.view'` lines; pulling the
    // quoted literals out is enough and does not need a TS parser.
    const declared = [...source.matchAll(/^\s*\|\s*'([^']+)'/gm)].map((match) => match[1]);

    expect([...declared].sort()).toEqual([...PERMISSIONS].sort());
  });
});

describe('the deliberate asymmetries (reconciliation §5)', () => {
  const holds = (role: PlatformRole, capability: Permission): boolean =>
    SEEDED_MATRIX[role].includes(capability);

  // These four are the ones a well-meaning future edit is most likely to
  // "fix". They are policy, and each has a stated reason.
  it('withholds the clinical capabilities from admin', () => {
    expect(holds('admin', 'ai.use')).toBe(false);
    expect(holds('admin', 'records.edit')).toBe(false);
    expect(holds('admin', 'prescriptions.create')).toBe(false);
  });

  it('withholds log access from doctor', () => {
    expect(holds('doctor', 'logs.view')).toBe(false);
    expect(holds('doctor', 'logs.export')).toBe(false);
  });

  it('gives admin the right to elevate, which doctor also holds', () => {
    // Not standing access on either row — RM M7.3 gates the reveal.
    expect(holds('admin', 'patients.revealIdentity')).toBe(true);
    expect(holds('doctor', 'patients.revealIdentity')).toBe(true);
  });
});

describe('catalogue integrity', () => {
  it('has metadata for every permission and no orphan metadata', () => {
    const metaIds = PERMISSION_CAPABILITIES.map((c: CapabilityMeta) => c.id);

    expect([...metaIds].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('never locks a capability both on and off for one role', () => {
    for (const capability of PERMISSION_CAPABILITIES) {
      for (const role of capability.lockedOn ?? []) {
        expect(
          capability.lockedOff?.includes(role) ?? false,
          `${capability.id} is locked both ways for ${role}`,
        ).toBe(false);
      }
    }
  });

  it('seeds every locked-on cell and no locked-off cell', () => {
    // The seed must already satisfy its own locks, or `normalizeMatrix`
    // would report the platform's baseline as needing repair.
    for (const capability of PERMISSION_CAPABILITIES) {
      for (const role of capability.lockedOn ?? []) {
        expect(SEEDED_MATRIX[role].includes(capability.id), `${role} needs ${capability.id}`).toBe(
          true,
        );
      }
      for (const role of capability.lockedOff ?? []) {
        expect(
          SEEDED_MATRIX[role].includes(capability.id),
          `${role} must not hold ${capability.id}`,
        ).toBe(false);
      }
    }
  });

  it('leaves no capability unheld by every role', () => {
    // An orphaned capability is a feature nobody can reach.
    for (const permission of PERMISSIONS) {
      const holders = PLATFORM_ROLES.filter((role) => SEEDED_MATRIX[role].includes(permission));

      expect(holders.length, `${permission} is held by no role`).toBeGreaterThan(0);
    }
  });
});
