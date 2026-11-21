/**
 * Permission matrix — the capabilities × roles model behind ADM-09 (UX §3.9).
 *
 * The capability ids are the `Permission` union from `@/types/auth`, which is
 * already the single source of truth for route guards and `useCan()`. This
 * module adds the *editable* half: what each platform role holds, which cells
 * an administrator is not allowed to move, and the pure diff/validation
 * helpers the editor and its tests share.
 *
 * Everything here is pure. Persistence lives in `admin-settings.api.ts`.
 */

import type { Permission } from '@/types/auth';

/* ── Roles ────────────────────────────────────────────────────── */

/**
 * The platform's role set. Defined here rather than in
 * `admin-settings.types.ts` so the matrix module has no dependency on the
 * settings document (the dependency runs the other way).
 */
export const PLATFORM_ROLES = ['admin', 'doctor', 'reception', 'laboratory', 'pharmacy'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  admin: 'Administrator',
  doctor: 'Doctor',
  reception: 'Reception',
  laboratory: 'Laboratory',
  pharmacy: 'Pharmacy',
};

/* ── Capabilities ─────────────────────────────────────────────── */

export const PERMISSION_GROUPS = [
  'Clinical data',
  'Scheduling',
  'Communication',
  'Administration',
  'Audit',
  'AI assistant',
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export interface CapabilityMeta {
  readonly id: Permission;
  readonly label: string;
  readonly description: string;
  readonly group: PermissionGroup;
  /**
   * Touches protected health information. Granting one is called out
   * separately in the review dialog and is what ADM-10's elevation gate
   * keys off.
   */
  readonly phi?: boolean;
  /** Roles that must always hold it — the switch is on and disabled. */
  readonly lockedOn?: readonly PlatformRole[];
  /** Roles that must never hold it — the switch is off and disabled. */
  readonly lockedOff?: readonly PlatformRole[];
  /** Shown in the lock tooltip; explains the rule rather than restating it. */
  readonly lockReason?: string;
}

const EVERY_ROLE_BUT_ADMIN: readonly PlatformRole[] = [
  'doctor',
  'reception',
  'laboratory',
  'pharmacy',
];

export const PERMISSION_CAPABILITIES: readonly CapabilityMeta[] = [
  /* ── Clinical data ──────────────────────────────────────────── */
  {
    id: 'patients.view',
    label: 'View patient directory',
    description: 'See the patient list and demographic summary, identifiers masked.',
    group: 'Clinical data',
  },
  {
    id: 'patients.revealIdentity',
    label: 'Reveal patient identity',
    description: 'Unmask a patient name or MRN. Every reveal is audit-logged.',
    group: 'Clinical data',
    phi: true,
  },
  {
    id: 'records.view',
    label: 'View medical records',
    description: 'Open record bodies, diagnoses, and attached clinical documents.',
    group: 'Clinical data',
    phi: true,
  },
  {
    id: 'records.edit',
    label: 'Author medical records',
    description: 'Create and amend records. Amendments are versioned, never overwritten.',
    group: 'Clinical data',
    lockedOff: ['reception', 'laboratory', 'pharmacy'],
    lockReason: 'Only clinical roles may author records.',
  },
  {
    id: 'prescriptions.create',
    label: 'Prescribe',
    description: 'Issue and renew prescriptions.',
    group: 'Clinical data',
    lockedOff: ['reception', 'laboratory', 'pharmacy'],
    lockReason: 'Prescribing is restricted to prescribing clinicians.',
  },
  {
    id: 'labs.review',
    label: 'Review lab results',
    description: 'Open lab reports and acknowledge critical values.',
    group: 'Clinical data',
    phi: true,
  },

  /* ── Scheduling ─────────────────────────────────────────────── */
  {
    id: 'appointments.manageOwn',
    label: 'Manage own appointments',
    description: 'Confirm, reschedule, and complete appointments on your own calendar.',
    group: 'Scheduling',
  },
  {
    id: 'appointments.reassign',
    label: 'Reassign across doctors',
    description: 'Move an appointment from one doctor to another.',
    group: 'Scheduling',
  },
  {
    id: 'appointments.cancelAdministratively',
    label: 'Cancel administratively',
    description: 'Cancel any appointment with an attributed administrative reason.',
    group: 'Scheduling',
  },

  /* ── Communication ──────────────────────────────────────────── */
  {
    id: 'messages.send',
    label: 'Send messages',
    description: 'Participate in conversations from your own account.',
    group: 'Communication',
  },
  {
    id: 'communications.viewMetadata',
    label: 'View conversation metadata',
    description: 'See participants, timestamps, and volume — never message bodies.',
    group: 'Communication',
  },
  {
    id: 'communications.viewContent',
    label: 'Read message content',
    description: 'Open message bodies through the gated, watermarked reader.',
    group: 'Communication',
    phi: true,
    lockedOff: ['laboratory', 'pharmacy'],
    lockReason: 'Content access is limited to oversight and clinical roles.',
  },
  {
    id: 'communications.resolveFlags',
    label: 'Resolve safety flags',
    description: 'Triage and close flagged conversations.',
    group: 'Communication',
  },

  /* ── Administration ─────────────────────────────────────────── */
  {
    id: 'doctors.manage',
    label: 'Manage doctor accounts',
    description: 'Create, suspend, and edit doctor accounts.',
    group: 'Administration',
  },
  {
    id: 'doctors.verify',
    label: 'Decide verifications',
    description: 'Approve or reject doctor credential submissions.',
    group: 'Administration',
    lockedOff: ['doctor'],
    lockReason: 'Doctors cannot sit on their own verification decisions.',
  },
  {
    id: 'patients.manageAccounts',
    label: 'Manage patient accounts',
    description: 'Unlock, reset credentials, and deactivate patient accounts.',
    group: 'Administration',
  },
  {
    id: 'roles.manage',
    label: 'Edit roles & permissions',
    description: 'Change this matrix.',
    group: 'Administration',
    lockedOn: ['admin'],
    lockedOff: EVERY_ROLE_BUT_ADMIN,
    lockReason: 'Only administrators may edit the permission matrix.',
  },
  {
    id: 'settings.manageSystem',
    label: 'Manage system settings',
    description: 'Change platform-wide configuration and security policy.',
    group: 'Administration',
    lockedOn: ['admin'],
    lockedOff: EVERY_ROLE_BUT_ADMIN,
    lockReason: 'Platform configuration is an administrator responsibility.',
  },
  {
    id: 'integrations.manage',
    label: 'Manage integrations',
    description: 'Connect, configure, and disable external services.',
    group: 'Administration',
    lockedOff: EVERY_ROLE_BUT_ADMIN,
    lockReason: 'Integration credentials are administrator-only.',
  },

  /* ── Audit ──────────────────────────────────────────────────── */
  {
    id: 'logs.view',
    label: 'View system logs',
    description: 'Open the investigation table of platform events.',
    group: 'Audit',
    lockedOn: ['admin'],
    lockReason: 'Removing audit visibility from every administrator would blind the platform.',
  },
  {
    id: 'logs.export',
    label: 'Export system logs',
    description: 'Download filtered log selections as CSV or JSON.',
    group: 'Audit',
  },

  /* ── AI assistant ───────────────────────────────────────────── */
  {
    id: 'ai.use',
    label: 'Use the AI assistant',
    description: 'Access AI drafting and summarization. Output always needs review.',
    group: 'AI assistant',
  },
];

const CAPABILITY_BY_ID = new Map<string, CapabilityMeta>(
  PERMISSION_CAPABILITIES.map((capability) => [capability.id, capability]),
);

export function findCapability(id: string): CapabilityMeta | undefined {
  return CAPABILITY_BY_ID.get(id);
}

/* ── Matrix ───────────────────────────────────────────────────── */

export type PermissionMatrix = Readonly<Record<PlatformRole, readonly Permission[]>>;

/** The persisted matrix plus the attribution and revision a save needs. */
export interface PermissionMatrixState {
  readonly matrix: PermissionMatrix;
  /** Bumped on every successful save; a stale base revision is a conflict. */
  readonly revision: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/**
 * The seeded baseline. Mirrors the capability bundles the mock auth backend
 * hands out, so the matrix describes the access the app actually grants
 * rather than an aspirational one.
 *
 * Written in reading order and then sorted into catalog order, so the
 * baseline is byte-identical to what `normalizePermissionMatrix` produces —
 * otherwise a round-trip through storage would look like a change.
 */
const SEEDED_MATRIX: PermissionMatrix = {
  admin: [
    'patients.view',
    // The right to elevate, not standing access — see ADM-10.
    'patients.revealIdentity',
    'patients.manageAccounts',
    'appointments.reassign',
    'appointments.cancelAdministratively',
    'messages.send',
    'communications.viewMetadata',
    'communications.viewContent',
    'communications.resolveFlags',
    'doctors.manage',
    'doctors.verify',
    'roles.manage',
    'settings.manageSystem',
    'integrations.manage',
    'logs.view',
    'logs.export',
  ],
  doctor: [
    'patients.view',
    'patients.revealIdentity',
    'records.view',
    'records.edit',
    'prescriptions.create',
    'labs.review',
    'appointments.manageOwn',
    'messages.send',
    'communications.viewMetadata',
    'ai.use',
  ],
  reception: [
    'patients.view',
    'appointments.manageOwn',
    'appointments.reassign',
    'messages.send',
    'communications.viewMetadata',
  ],
  laboratory: ['patients.view', 'records.view', 'labs.review', 'messages.send'],
  pharmacy: ['patients.view', 'messages.send'],
};

export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = Object.fromEntries(
  PLATFORM_ROLES.map((role) => [role, orderCapabilities(SEEDED_MATRIX[role])] as const),
) as PermissionMatrix;

export const DEFAULT_PERMISSION_STATE: PermissionMatrixState = {
  matrix: DEFAULT_PERMISSION_MATRIX,
  revision: 1,
  updatedAt: '2026-07-01T09:00:00Z',
  updatedBy: 'Platform baseline',
};

export function hasCapability(
  matrix: PermissionMatrix,
  role: PlatformRole,
  capability: Permission,
): boolean {
  return matrix[role].includes(capability);
}

/**
 * Returns the matrix with one cell set. A locked cell is returned unchanged —
 * the safety rules hold even if a caller ignores the disabled control.
 */
export function setCapability(
  matrix: PermissionMatrix,
  role: PlatformRole,
  capability: Permission,
  granted: boolean,
): PermissionMatrix {
  if (lockOf(capability, role) !== null) return matrix;
  const held = matrix[role];
  if (held.includes(capability) === granted) return matrix;
  return {
    ...matrix,
    [role]: granted
      ? orderCapabilities([...held, capability])
      : held.filter((id) => id !== capability),
  };
}

function orderCapabilities(ids: readonly Permission[]): readonly Permission[] {
  const order = PERMISSION_CAPABILITIES.map((capability) => capability.id);
  return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/* ── Safety rules ─────────────────────────────────────────────── */

export type CellLock = { readonly value: boolean; readonly reason: string };

/** The lock on one cell, or null when the administrator may move it. */
export function lockOf(capability: Permission, role: PlatformRole): CellLock | null {
  const meta = CAPABILITY_BY_ID.get(capability);
  if (!meta) return null;
  const fallback = 'This cell is fixed by platform policy.';
  if (meta.lockedOn?.includes(role)) {
    return { value: true, reason: meta.lockReason ?? fallback };
  }
  if (meta.lockedOff?.includes(role)) {
    return { value: false, reason: meta.lockReason ?? fallback };
  }
  return null;
}

/**
 * Capabilities no role would hold. Saving one of these would leave the
 * platform with a feature nobody can reach, so it blocks the save.
 */
export function orphanedCapabilities(matrix: PermissionMatrix): readonly CapabilityMeta[] {
  return PERMISSION_CAPABILITIES.filter((capability) =>
    PLATFORM_ROLES.every((role) => !matrix[role].includes(capability.id)),
  );
}

/**
 * Repairs any matrix — a stored document from an older capability set, a
 * hand-edited one, or junk — into a valid one: known ids only, locks applied.
 */
export function normalizePermissionMatrix(input: unknown): PermissionMatrix {
  const source =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

  const entries = PLATFORM_ROLES.map((role) => {
    const raw = source[role];
    const stored: readonly Permission[] = Array.isArray(raw)
      ? raw.filter((id): id is Permission => typeof id === 'string' && CAPABILITY_BY_ID.has(id))
      : DEFAULT_PERMISSION_MATRIX[role];

    const held = new Set<Permission>(stored);
    for (const capability of PERMISSION_CAPABILITIES) {
      const lock = lockOf(capability.id, role);
      if (lock === null) continue;
      if (lock.value) held.add(capability.id);
      else held.delete(capability.id);
    }
    return [role, orderCapabilities([...held])] as const;
  });

  return Object.fromEntries(entries) as PermissionMatrix;
}

export function normalizePermissionState(input: unknown): PermissionMatrixState {
  if (typeof input !== 'object' || input === null) return DEFAULT_PERMISSION_STATE;
  const stored = input as Partial<PermissionMatrixState>;
  return {
    matrix: normalizePermissionMatrix(stored.matrix),
    revision:
      typeof stored.revision === 'number' ? stored.revision : DEFAULT_PERMISSION_STATE.revision,
    updatedAt:
      typeof stored.updatedAt === 'string' ? stored.updatedAt : DEFAULT_PERMISSION_STATE.updatedAt,
    updatedBy:
      typeof stored.updatedBy === 'string' ? stored.updatedBy : DEFAULT_PERMISSION_STATE.updatedBy,
  };
}

/* ── Diff & preview ───────────────────────────────────────────── */

export interface PermissionChange {
  readonly role: PlatformRole;
  readonly capability: CapabilityMeta;
  /** The value the draft would save. */
  readonly next: boolean;
}

/** Every cell that differs, in matrix reading order (group → capability → role). */
export function diffMatrix(base: PermissionMatrix, draft: PermissionMatrix): PermissionChange[] {
  const changes: PermissionChange[] = [];
  for (const capability of PERMISSION_CAPABILITIES) {
    for (const role of PLATFORM_ROLES) {
      const before = base[role].includes(capability.id);
      const after = draft[role].includes(capability.id);
      if (before !== after) changes.push({ role, capability, next: after });
    }
  }
  return changes;
}

export interface AffectedRole {
  readonly role: PlatformRole;
  readonly grants: number;
  readonly revokes: number;
  readonly users: number;
}

export interface AffectedPreview {
  readonly roles: readonly AffectedRole[];
  /** Distinct active accounts across every changed role. */
  readonly users: number;
  readonly phiGrants: readonly PermissionChange[];
}

export interface RoleHolder {
  readonly id: string;
  readonly role: PlatformRole;
  readonly active: boolean;
}

/**
 * Who a pending change set would actually reach. Only active accounts are
 * counted — a deactivated account cannot exercise a capability, and an
 * inflated number is worse than no number on a confirmation screen.
 */
export function previewAffected(
  changes: readonly PermissionChange[],
  holders: readonly RoleHolder[],
): AffectedPreview {
  const counts = Object.fromEntries(
    PLATFORM_ROLES.map((role) => [
      role,
      holders.filter((holder) => holder.role === role && holder.active).length,
    ]),
  ) as Record<PlatformRole, number>;
  return previewAffectedByCounts(changes, counts);
}

/**
 * The same preview from per-role counts of active accounts — what the live
 * API serves (`GET /roles`'s `activeMembers`) instead of the accounts
 * themselves. Each account holds one role, so the per-role counts add up
 * to the distinct total.
 */
export function previewAffectedByCounts(
  changes: readonly PermissionChange[],
  activeByRole: Readonly<Record<PlatformRole, number>>,
): AffectedPreview {
  const roles = PLATFORM_ROLES.map((role) => {
    const forRole = changes.filter((change) => change.role === role);
    return {
      role,
      grants: forRole.filter((change) => change.next).length,
      revokes: forRole.filter((change) => !change.next).length,
      users: activeByRole[role],
    };
  }).filter((entry) => entry.grants + entry.revokes > 0);

  return {
    roles,
    users: roles.reduce((total, entry) => total + entry.users, 0),
    phiGrants: changes.filter((change) => change.next && change.capability.phi === true),
  };
}

/**
 * A proposed matrix as the review dialog shows it — API §15.3's dry run.
 *
 * `changes` are the cells that would really move once locks are applied,
 * which can be fewer than the cells the editor shows as changed; `orphaned`
 * are the capabilities no role would hold, which the save refuses.
 */
export interface MatrixPreview extends AffectedPreview {
  readonly changes: readonly PermissionChange[];
  readonly orphaned: readonly CapabilityMeta[];
}

/** The dry run computed here, for an adapter that has no server to ask. */
export function localMatrixPreview(
  base: PermissionMatrix,
  proposed: PermissionMatrix,
  activeByRole: Readonly<Record<PlatformRole, number>>,
): MatrixPreview {
  const normalized = normalizePermissionMatrix(proposed);
  const changes = diffMatrix(base, normalized);
  return {
    ...previewAffectedByCounts(changes, activeByRole),
    changes,
    orphaned: orphanedCapabilities(normalized),
  };
}

/* ── Concurrent-edit merge (UX §3.9 "save conflicts") ─────────── */

export class PermissionConflictError extends Error {
  readonly current: PermissionMatrixState;

  constructor(current: PermissionMatrixState) {
    super('The permission matrix changed since this editor was opened.');
    this.name = 'PermissionConflictError';
    this.current = current;
  }
}

export function isPermissionConflict(error: unknown): error is PermissionConflictError {
  return error instanceof PermissionConflictError;
}
