/**
 * Auth contracts — FRONTEND_ARCHITECTURE.md §6.5 / §9.
 * The single source of truth for roles and capabilities. Route guards,
 * navigation configs, and `useCan()` all derive from these unions —
 * a capability that is not listed here cannot be referenced anywhere.
 */

/**
 * Coarse role — selects the route tree and shell configuration.
 *
 * The three staff roles (DEC-006) have their own workspaces. What any role may
 * *do* is decided per request by the server against the permission matrix;
 * the role only chooses which screens are drawn.
 */
export type Role = 'doctor' | 'admin' | 'reception' | 'laboratory' | 'pharmacy';

/** Every role the web client can place, in one list for adapters to check against. */
export const ROLES: readonly Role[] = ['doctor', 'admin', 'reception', 'laboratory', 'pharmacy'];

/**
 * Fine-grained capabilities from the permission matrix (UX 3.9).
 * Naming: `<domain>.<action>`. Extend this union as features land;
 * never pass free-form strings as permissions.
 */
export type Permission =
  // Clinical data
  | 'patients.view'
  | 'patients.revealIdentity'
  | 'records.view'
  | 'records.edit'
  | 'prescriptions.create'
  | 'labs.review'
  // Scheduling
  | 'appointments.manageOwn'
  | 'appointments.reassign'
  | 'appointments.cancelAdministratively'
  // Communication
  | 'messages.send'
  | 'communications.viewMetadata'
  | 'communications.viewContent'
  | 'communications.resolveFlags'
  // Administration
  | 'doctors.manage'
  | 'doctors.verify'
  | 'patients.manageAccounts'
  | 'roles.manage'
  | 'settings.manageSystem'
  | 'integrations.manage'
  // Audit
  | 'logs.view'
  | 'logs.export'
  // AI
  | 'ai.use';

/** The authenticated user as exposed by the AuthProvider — nothing more. */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly permissions: readonly Permission[];
  /**
   * The clinic this account belongs to (D-27b).
   *
   * Medora is multi-clinic and the product model is **one doctor, one
   * primary clinic**: a doctor may see and act on their own clinic's data
   * and no other's. This field is what the frontend scopes by.
   *
   * **It is not the security boundary and must never be treated as one.**
   * Everything a client filters, a client can unfilter — the isolation has
   * to be enforced server-side, on every read and every write, from the
   * session rather than from any request parameter. What the frontend owes
   * the policy is that it never *displays* another clinic's data and never
   * offers an action against it. See `docs/handoff/clinic-isolation.md`.
   *
   * Optional because an admin is not scoped to one clinic — platform
   * administration spans them — so `undefined` means "not clinic-scoped",
   * which is a different claim from "scoped to nothing".
   */
  readonly clinicId?: string | undefined;
}

/** AuthProvider lifecycle — FRONTEND_ARCHITECTURE.md §6.3. */
export type AuthStatus = 'booting' | 'authenticated' | 'unauthenticated' | 'locked';

/**
 * The auth seam's contract — the port both adapters implement and the
 * coded errors every auth page branches on. See `api/seam.ts`.
 */
export {
  AuthError,
  isAuthError,
  ReauthLockoutError,
  UnsupportedRoleError,
  type AuthErrorCode,
} from './auth-error';
export type {
  AuthService,
  AuthSession,
  DoctorRegisterInput,
  LoginInput,
  LoginOutcome,
  PatientRegisterInput,
  PendingSignIn,
  RegisterInput,
  RegisterResult,
} from './auth-service';

/**
 * The administrator invitation seam (ADR-035 §5) — a second port beside
 * `AuthService`, because these calls mint no session.
 */
export type {
  InvitationActivated,
  InvitationEnrolment,
  InvitationService,
} from './invitation-service';
