import type { Permission, SessionUser } from '@/types/auth';

import type { MockUserRecord } from './types';

/**
 * Seeded accounts for the mock auth backend.
 * Credentials are surfaced on the login page as a demo hint. Specific
 * addresses trigger the branch flows: `unverified@` → verify-email,
 * `secure@` → verify-otp. Everything here is fake and frontend-only.
 */

export const MOCK_PASSWORD = 'Medora123!';

/** Capability bundles derived from the permission matrix (types/auth). */
const DOCTOR_PERMISSIONS: readonly Permission[] = [
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
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  'patients.view',
  // Not "sees patient names": holds the *right to elevate*. Identifiers stay
  // masked until a justification is given and logged (ADM-10, UX §1.5.6).
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
];

/*
 * The three staff roles (DEC-006). Each bundle is the server's seeded one
 * (`backend/src/shared/authz/permission-catalogue.ts` SEEDED_MATRIX), so the
 * demo cannot let a role do what the API would refuse it;
 * `app/router/staff-permissions.test.ts` holds the lists to the admin matrix's copy.
 */
export const RECEPTION_PERMISSIONS: readonly Permission[] = [
  'patients.view',
  'appointments.manageOwn',
  'appointments.reassign',
  'messages.send',
  'communications.viewMetadata',
];

export const LABORATORY_PERMISSIONS: readonly Permission[] = [
  'patients.view',
  'records.view',
  'labs.review',
  'messages.send',
];

export const PHARMACY_PERMISSIONS: readonly Permission[] = ['patients.view', 'messages.send'];

export const seededUsers: readonly MockUserRecord[] = [
  {
    id: 'usr_doctor_amelia',
    clinicId: 'clinic-meadowbrook',
    name: 'Dr. Amelia Chen',
    email: 'doctor@medora.health',
    role: 'doctor',
    permissions: DOCTOR_PERMISSIONS,
    password: MOCK_PASSWORD,
    emailVerified: true,
    twoFactorEnabled: false,
  },
  {
    id: 'usr_admin_marcus',
    name: 'Marcus Reed',
    email: 'admin@medora.health',
    role: 'admin',
    permissions: ADMIN_PERMISSIONS,
    password: MOCK_PASSWORD,
    emailVerified: true,
    twoFactorEnabled: false,
  },
  {
    id: 'usr_doctor_unverified',
    clinicId: 'clinic-meadowbrook',
    name: 'Dr. Priya Nair',
    email: 'unverified@medora.health',
    role: 'doctor',
    permissions: DOCTOR_PERMISSIONS,
    password: MOCK_PASSWORD,
    emailVerified: false,
    twoFactorEnabled: false,
  },
  {
    id: 'usr_doctor_secure',
    clinicId: 'clinic-meadowbrook',
    name: 'Dr. Julian Ford',
    email: 'secure@medora.health',
    role: 'doctor',
    permissions: DOCTOR_PERMISSIONS,
    password: MOCK_PASSWORD,
    emailVerified: true,
    twoFactorEnabled: true,
  },
  {
    id: 'usr_reception_sara',
    name: 'Sara Haddad',
    email: 'reception@medora.health',
    role: 'reception',
    permissions: RECEPTION_PERMISSIONS,
    password: MOCK_PASSWORD,
    emailVerified: true,
    twoFactorEnabled: false,
  },
  {
    id: 'usr_laboratory_omar',
    name: 'Omar Saleh',
    email: 'lab@medora.health',
    role: 'laboratory',
    permissions: LABORATORY_PERMISSIONS,
    password: MOCK_PASSWORD,
    emailVerified: true,
    twoFactorEnabled: false,
  },
  {
    id: 'usr_pharmacy_lina',
    name: 'Lina Farouk',
    email: 'pharmacy@medora.health',
    role: 'pharmacy',
    permissions: PHARMACY_PERMISSIONS,
    password: MOCK_PASSWORD,
    emailVerified: true,
    twoFactorEnabled: false,
  },
];

/**
 * One row of the login-page demo hint.
 *
 * `note` says what an account *demonstrates*, and it is optional because
 * only two of the four have anything to say: `doctor@` and `admin@` sign
 * straight in, which the label already tells you. The two below them
 * deliberately do not, and without a note their addresses look like dead
 * fixtures rather than the only way into two finished screens.
 */
export interface DemoAccount {
  readonly label: string;
  readonly email: string;
  readonly note?: string;
}

/**
 * Accounts advertised in the login-page demo hint.
 *
 * All four are seeded above with the same password. The hint lists all of
 * them; the one-click **buttons** are a different affordance entirely —
 * they live in `dev/DemoAccessPanel.tsx` and use its own `DEMO_DOCTOR_ACCOUNT`,
 * not this array. Adding a row here therefore
 * cannot add a button, which is what keeps "one click" meaning one click.
 *
 * The two branch accounts were absent from this list until now. They
 * worked the whole time — `unverified@` routes to `/verify-email` and
 * `secure@` to `/verify-otp`, both end to end — but nothing on screen said
 * they existed, so the two screens they reach were unreachable in a demo.
 * That was a discoverability gap, not a missing feature, and listing them
 * is the whole of the fix.
 *
 * The notes are English and not routed through `useT()`, matching the
 * labels beside them and `DemoAccessPanel`'s own copy: translating demo
 * scaffolding would put permanent strings into all five catalogues to
 * serve a hint that only appears when the mock backend is on.
 */
export const demoAccounts: readonly DemoAccount[] = [
  { label: 'Doctor', email: 'doctor@medora.health' },
  { label: 'Admin', email: 'admin@medora.health' },
  {
    label: 'Doctor (unverified)',
    email: 'unverified@medora.health',
    note: 'Email unverified — see the verification screen',
  },
  {
    label: 'Doctor (2FA)',
    email: 'secure@medora.health',
    note: '2FA enabled — see the OTP step-up',
  },
  { label: 'Reception', email: 'reception@medora.health' },
  { label: 'Laboratory', email: 'lab@medora.health' },
  { label: 'Pharmacy', email: 'pharmacy@medora.health' },
];

export function findUser(email: string): MockUserRecord | undefined {
  const normalized = email.trim().toLowerCase();
  return seededUsers.find((u) => u.email.toLowerCase() === normalized);
}

/** Strip mock-only fields down to the public session contract. */
export function toSessionUser(record: MockUserRecord): SessionUser {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    permissions: record.permissions,
    // D-27b: the doctor's primary clinic travels on the session, so the
    // frontend can reflect the isolation policy. An admin has none —
    // platform administration spans clinics.
    ...(record.clinicId === undefined ? {} : { clinicId: record.clinicId }),
  };
}
