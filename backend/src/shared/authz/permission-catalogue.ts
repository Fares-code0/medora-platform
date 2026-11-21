/**
 * The authorization vocabulary (RM M7.1, API §15, UX §3.9).
 *
 * Every capability the platform can check, every role that can hold one,
 * which cells an administrator may not move, and the bundles each role
 * starts with.
 *
 * **This file is a transcription, not a definition.** The source of truth
 * is the frontend, which shipped the whole vocabulary at ADM-09:
 * `frontend/src/types/auth/index.ts` declares the union and
 * `frontend/src/features/admin/permissions.ts` carries the metadata,
 * locks and bundles. A capability that is not in that union cannot exist
 * here — a 23rd permission is a frontend change first.
 *
 * `permission-catalogue.spec.ts` loads both frontend modules and asserts
 * equality, so the transcription is checked rather than trusted. If you
 * are editing this file because the frontend changed, that spec is what
 * tells you whether you got it right.
 */

/**
 * The five roles the permission matrix is indexed by.
 *
 * Note this is *not* `types/auth`'s `Role`, which is the coarse
 * `'doctor' | 'admin'` that selects the SPA's route tree. Authorization
 * is decided against the matrix, and the matrix has five columns. The
 * projection between the two belongs to session issue at M6.2 — see
 * ADR-027 open item RA-027.1, which is open precisely because three of
 * these roles have bundles but no shell to log into.
 */
export const PLATFORM_ROLES = ['admin', 'doctor', 'reception', 'laboratory', 'pharmacy'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export const PERMISSION_GROUPS = [
  'Clinical data',
  'Scheduling',
  'Communication',
  'Administration',
  'Audit',
  'AI assistant',
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

/**
 * Written before `Permission` so the type can be derived from the data
 * rather than declared beside it. A union maintained in two places drifts
 * the first time someone edits one of them.
 */
export const PERMISSIONS = [
  // Clinical data
  'patients.view',
  'patients.revealIdentity',
  'records.view',
  'records.edit',
  'prescriptions.create',
  'labs.review',
  // Scheduling
  'appointments.manageOwn',
  'appointments.reassign',
  'appointments.cancelAdministratively',
  // Communication
  'messages.send',
  'communications.viewMetadata',
  'communications.viewContent',
  'communications.resolveFlags',
  // Administration
  'doctors.manage',
  'doctors.verify',
  'patients.manageAccounts',
  'roles.manage',
  'settings.manageSystem',
  'integrations.manage',
  // Audit
  'logs.view',
  'logs.export',
  // AI
  'ai.use',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export interface CapabilityMeta {
  readonly id: Permission;
  readonly group: PermissionGroup;
  /**
   * Touches protected health information. Drives ADM-10's elevation gate
   * on the client; on the server it marks which reads must be audited
   * even when they are permitted.
   */
  readonly phi?: boolean;
  /** Roles that must always hold it. An override cannot revoke it. */
  readonly lockedOn?: readonly PlatformRole[];
  /** Roles that must never hold it. An override cannot grant it. */
  readonly lockedOff?: readonly PlatformRole[];
  /** Why the cell is fixed — surfaced in the 409 when an edit tries to move it. */
  readonly lockReason?: string;
}

const EVERY_ROLE_BUT_ADMIN: readonly PlatformRole[] = [
  'doctor',
  'reception',
  'laboratory',
  'pharmacy',
];

/**
 * Capability metadata, in catalogue order.
 *
 * The locks are the half that matters on the server. On the client they
 * disable a switch; here they are the rule that a `PUT /roles/matrix`
 * body is checked against (reconciliation §5 rule 2), and the rule that
 * a per-user override cannot beat. `roles.manage` locked on for admin is
 * what stops the platform from being administered into a state where
 * nobody can administer it.
 */
export const PERMISSION_CAPABILITIES: readonly CapabilityMeta[] = [
  /* ── Clinical data ──────────────────────────────────────────── */
  { id: 'patients.view', group: 'Clinical data' },
  { id: 'patients.revealIdentity', group: 'Clinical data', phi: true },
  { id: 'records.view', group: 'Clinical data', phi: true },
  {
    id: 'records.edit',
    group: 'Clinical data',
    lockedOff: ['reception', 'laboratory', 'pharmacy'],
    lockReason: 'Only clinical roles may author records.',
  },
  {
    id: 'prescriptions.create',
    group: 'Clinical data',
    lockedOff: ['reception', 'laboratory', 'pharmacy'],
    lockReason: 'Prescribing is restricted to prescribing clinicians.',
  },
  { id: 'labs.review', group: 'Clinical data', phi: true },

  /* ── Scheduling ─────────────────────────────────────────────── */
  { id: 'appointments.manageOwn', group: 'Scheduling' },
  { id: 'appointments.reassign', group: 'Scheduling' },
  { id: 'appointments.cancelAdministratively', group: 'Scheduling' },

  /* ── Communication ──────────────────────────────────────────── */
  { id: 'messages.send', group: 'Communication' },
  { id: 'communications.viewMetadata', group: 'Communication' },
  {
    id: 'communications.viewContent',
    group: 'Communication',
    phi: true,
    lockedOff: ['laboratory', 'pharmacy'],
    lockReason: 'Content access is limited to oversight and clinical roles.',
  },
  { id: 'communications.resolveFlags', group: 'Communication' },

  /* ── Administration ─────────────────────────────────────────── */
  { id: 'doctors.manage', group: 'Administration' },
  {
    id: 'doctors.verify',
    group: 'Administration',
    lockedOff: ['doctor'],
    lockReason: 'Doctors cannot sit on their own verification decisions.',
  },
  { id: 'patients.manageAccounts', group: 'Administration' },
  {
    id: 'roles.manage',
    group: 'Administration',
    lockedOn: ['admin'],
    lockedOff: EVERY_ROLE_BUT_ADMIN,
    lockReason: 'Only administrators may edit the permission matrix.',
  },
  {
    id: 'settings.manageSystem',
    group: 'Administration',
    lockedOn: ['admin'],
    lockedOff: EVERY_ROLE_BUT_ADMIN,
    lockReason: 'Platform configuration is an administrator responsibility.',
  },
  {
    id: 'integrations.manage',
    group: 'Administration',
    lockedOff: EVERY_ROLE_BUT_ADMIN,
    lockReason: 'Integration credentials are administrator-only.',
  },

  /* ── Audit ──────────────────────────────────────────────────── */
  {
    id: 'logs.view',
    group: 'Audit',
    lockedOn: ['admin'],
    lockReason: 'Removing audit visibility from every administrator would blind the platform.',
  },
  { id: 'logs.export', group: 'Audit' },

  /* ── AI assistant ───────────────────────────────────────────── */
  { id: 'ai.use', group: 'AI assistant' },
];

const CAPABILITY_BY_ID: ReadonlyMap<string, CapabilityMeta> = new Map(
  PERMISSION_CAPABILITIES.map((capability) => [capability.id, capability]),
);

export function findCapability(id: string): CapabilityMeta | undefined {
  return CAPABILITY_BY_ID.get(id);
}

/** Capabilities that touch PHI — the reads M28 must audit even when allowed. */
export const PHI_CAPABILITIES: readonly Permission[] = PERMISSION_CAPABILITIES.filter(
  (capability) => capability.phi === true,
).map((capability) => capability.id);

export type PermissionMatrix = Readonly<Record<PlatformRole, readonly Permission[]>>;

/**
 * The bundle each role is seeded with — M5.1's seed, expressed as data so
 * the resolver has something to resolve before that migration exists.
 *
 * Three asymmetries in the admin column are deliberate rather than
 * oversights, and reconciliation §5 calls them out: **admin holds no
 * `ai.use`** (the assistant is a clinical tool), **no `records.edit`** and
 * **no `prescriptions.create`**. The mirror-image asymmetry is that
 * **doctor holds no log access**. A future edit that "tidies" any of the
 * four is a policy change, not a cleanup.
 *
 * `patients.revealIdentity` on the admin row is the right to *elevate*,
 * not standing access: identifiers stay masked until a justification is
 * given and the audit write succeeds (ADM-10, RM M7.3).
 */
export const SEEDED_MATRIX: PermissionMatrix = {
  admin: [
    'patients.view',
    'patients.revealIdentity',
    'appointments.reassign',
    'appointments.cancelAdministratively',
    'messages.send',
    'communications.viewMetadata',
    'communications.viewContent',
    'communications.resolveFlags',
    'doctors.manage',
    'doctors.verify',
    'patients.manageAccounts',
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

const CATALOGUE_ORDER: ReadonlyMap<Permission, number> = new Map(
  PERMISSION_CAPABILITIES.map((capability, index) => [capability.id, index]),
);

/**
 * Sorts into catalogue order. Every matrix that leaves this kernel is
 * ordered, so two matrices with the same members compare equal by value
 * and a round trip through storage does not read as a change.
 */
export function orderCapabilities(ids: Iterable<Permission>): readonly Permission[] {
  return [...ids].sort(
    (a, b) =>
      (CATALOGUE_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (CATALOGUE_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * The seeded bundle for a role code, or **empty** for a role that has no
 * column in the matrix.
 *
 * The `roles` table carries six codes; this matrix has five columns.
 * `nurse` is the difference, and it is deliberate on both sides: ADR-017
 * §6 puts the wider staff vocabulary in `roles`, while the ADM-09 matrix
 * has no nurse column because no source states what a nurse may do. The
 * M5 seed calls an empty bundle "the fail-closed reading", and this is
 * the same reading on the resolution side.
 *
 * Returning `[]` rather than throwing matters: a nurse can hold an
 * account and therefore can authenticate, so authorization is asked
 * about them. The honest answer is "nothing", not a 500.
 */
export function bundleFor(roleCode: string): readonly Permission[] {
  return isPlatformRole(roleCode) ? SEEDED_MATRIX[roleCode] : [];
}
