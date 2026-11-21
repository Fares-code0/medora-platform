/**
 * The permission vocabulary and the role bundles (RM M5.1).
 *
 * ## Why this file is a transcription and not a derivation
 *
 * `frontend/src/types/auth/index.ts` states the rule this table exists to
 * keep: "a capability that is not listed here cannot be referenced
 * anywhere." The union is the vocabulary. So the 22 codes below are the
 * union, written out, and `assertVocabularyIntact` fails the seed if the
 * database ends up holding anything else.
 *
 * They are transcribed by hand rather than imported from the frontend.
 * The backend does not depend on the frontend package, and a seed that
 * read its expectations from the thing it is seeding would pass just as
 * happily when a permission is dropped.
 *
 * Sources, both rank-1 frontend code:
 *   · codes + grouping  — `frontend/src/features/admin/permissions.ts`
 *     (`PERMISSION_CAPABILITIES`, the ADM-09 matrix editor's catalogue)
 *   · role bundles      — the same file's `SEEDED_MATRIX`, which mirrors
 *     the bundles `features/auth/mock/users.ts` hands out at login
 */

/** A capability, exactly as the `Permission` union spells it. */
export interface PermissionSeed {
  readonly code: string;
  /** The UX §3.9 matrix group. Stored in `permissions.domain`. */
  readonly domain: string;
  readonly description: string;
}

/**
 * All 22. Order follows the frontend catalogue, which is the order the
 * matrix editor renders — keeping them aligned makes a diff between the
 * two readable.
 */
export const PERMISSIONS: readonly PermissionSeed[] = [
  // Clinical data
  {
    code: 'patients.view',
    domain: 'Clinical data',
    description: 'See the patient list and demographic summary, identifiers masked.',
  },
  {
    code: 'patients.revealIdentity',
    domain: 'Clinical data',
    description: 'Reveal a masked patient identity, with justification and audit.',
  },
  { code: 'records.view', domain: 'Clinical data', description: 'View medical records.' },
  { code: 'records.edit', domain: 'Clinical data', description: 'Author medical records.' },
  { code: 'prescriptions.create', domain: 'Clinical data', description: 'Prescribe medication.' },
  { code: 'labs.review', domain: 'Clinical data', description: 'Review lab results.' },
  // Scheduling
  {
    code: 'appointments.manageOwn',
    domain: 'Scheduling',
    description: 'Manage own appointments.',
  },
  {
    code: 'appointments.reassign',
    domain: 'Scheduling',
    description: 'Reassign appointments across doctors.',
  },
  {
    code: 'appointments.cancelAdministratively',
    domain: 'Scheduling',
    description: 'Cancel an appointment administratively, with a reason.',
  },
  // Communication
  { code: 'messages.send', domain: 'Communication', description: 'Send messages.' },
  {
    code: 'communications.viewMetadata',
    domain: 'Communication',
    description: 'View conversation metadata without message content.',
  },
  {
    code: 'communications.viewContent',
    domain: 'Communication',
    description: 'Read message content, under the content-access gate.',
  },
  {
    code: 'communications.resolveFlags',
    domain: 'Communication',
    description: 'Resolve safety flags.',
  },
  // Administration
  { code: 'doctors.manage', domain: 'Administration', description: 'Manage doctor accounts.' },
  { code: 'doctors.verify', domain: 'Administration', description: 'Decide doctor verifications.' },
  {
    code: 'patients.manageAccounts',
    domain: 'Administration',
    description: 'Manage patient accounts.',
  },
  { code: 'roles.manage', domain: 'Administration', description: 'Edit roles and permissions.' },
  {
    code: 'settings.manageSystem',
    domain: 'Administration',
    description: 'Manage system settings.',
  },
  {
    code: 'integrations.manage',
    domain: 'Administration',
    description: 'Manage platform integrations.',
  },
  // Audit
  { code: 'logs.view', domain: 'Audit', description: 'View system logs.' },
  { code: 'logs.export', domain: 'Audit', description: 'Export system logs.' },
  // AI
  {
    code: 'ai.use',
    domain: 'AI assistant',
    description: 'Access AI drafting and summarization. Output always needs review.',
  },
];

/** A role that can sign in, with the bundle it carries. */
export interface RoleSeed {
  readonly code: string;
  readonly label: string;
  readonly permissions: readonly string[];
}

/**
 * The seeded roles.
 *
 * Five of them carry bundles, and those five are `PLATFORM_ROLES` from the
 * matrix editor — the only roles for which any source states a capability
 * set. The bundles below are `SEEDED_MATRIX` verbatim.
 *
 * `nurse` is seeded with **no** bundle. ADR-017 §6 puts the wider staff
 * vocabulary in this table ("`reception`, `laboratory`, `pharmacy`,
 * `nurse` … resolve through the same `roles` table"), but the ADM-09
 * matrix has no nurse column, so no source says what a nurse may do.
 * An empty bundle is the fail-closed reading: the role exists and grants
 * nothing until an administrator grants something.
 *
 * `patient` is seeded the same way, and for a related reason (ADR-030 §6).
 * It is a role a user can hold; it is **not** a column in the ADM-09
 * permission matrix, and it must never become one. `PLATFORM_ROLES` in
 * `shared/authz/permission-catalogue.ts` is a *transcription of the
 * frontend*, bound by a parity spec that CI runs whenever the frontend
 * source changes — so a sixth column could not be added here without
 * editing the other tree. It would also be wrong on its own terms: those
 * 22 capabilities are clinician capabilities an administrator grants to
 * staff, and a `patient` column would put every patient into that editor
 * as a grantable principal.
 *
 * The empty bundle is therefore not a placeholder awaiting a product
 * decision the way `nurse`'s is — it is the design. A patient principal
 * resolves to zero capabilities, so **every `@Can(...)` route in the
 * platform denies them without a line of code being written**. Patient
 * authorization is ownership-based instead: "is this patient, acting on
 * their own row", resolved through `patients.user_id`.
 *
 * One vocabulary member from DB §14.5-7 remains deliberately absent:
 *   · `receptionist` — the `StaffRole` spelling of `reception`, which
 *     §14.5-7 resolves as an alias of one role, not as a second role.
 *     It survives as a value of the `staff_role` enum on `staff_members`.
 */
export const ROLES: readonly RoleSeed[] = [
  {
    code: 'admin',
    label: 'Administrator',
    permissions: [
      'patients.view',
      // The right to elevate, not standing access (ADM-10, UX §1.5.6).
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
  },
  {
    code: 'doctor',
    label: 'Doctor',
    permissions: [
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
  },
  {
    code: 'reception',
    label: 'Reception',
    permissions: [
      'patients.view',
      'appointments.manageOwn',
      'appointments.reassign',
      'messages.send',
      'communications.viewMetadata',
    ],
  },
  {
    code: 'laboratory',
    label: 'Laboratory',
    permissions: ['patients.view', 'records.view', 'labs.review', 'messages.send'],
  },
  { code: 'pharmacy', label: 'Pharmacy', permissions: ['patients.view', 'messages.send'] },
  { code: 'nurse', label: 'Nurse', permissions: [] },
  // ADR-030 §6. Holds nothing by design — see the note above.
  { code: 'patient', label: 'Patient', permissions: [] },
];

/**
 * Fails fast if a bundle names a capability the union does not contain.
 *
 * Without this a typo in a bundle would seed a role holding a permission
 * that no guard will ever check — which reads, in the matrix editor, as a
 * granted capability that silently does nothing.
 */
export function assertBundlesReferenceKnownCodes(): void {
  const known = new Set(PERMISSIONS.map((permission) => permission.code));
  for (const role of ROLES) {
    for (const code of role.permissions) {
      if (!known.has(code)) {
        throw new Error(`Role "${role.code}" references unknown permission "${code}"`);
      }
    }
  }
}
