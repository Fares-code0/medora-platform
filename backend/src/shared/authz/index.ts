/**
 * Public API — authorization (RM M7.1, M7.2).
 *
 * The three placeholder implementations are deliberately not exported.
 * Modules inject `ROLE_REPOSITORY`, `PERMISSION_CACHE` and
 * `PATIENT_ASSIGNMENT_REPOSITORY` and depend on the interfaces, so M5
 * and M6 can replace what sits behind each token without touching a
 * single call site — the same contract `shared/audit` has held since M2.
 */

export {
  PERMISSIONS,
  PERMISSION_CAPABILITIES,
  PERMISSION_GROUPS,
  PHI_CAPABILITIES,
  PLATFORM_ROLES,
  SEEDED_MATRIX,
  bundleFor,
  findCapability,
  isPermission,
  isPlatformRole,
  orderCapabilities,
  type CapabilityMeta,
  type Permission,
  type PermissionGroup,
  type PermissionMatrix,
  type PlatformRole,
} from './permission-catalogue';

export {
  applyLocks,
  diffMatrix,
  hasCapability,
  lockOf,
  lockViolations,
  normalizeMatrix,
  orphanedCapabilities,
  setCapability,
  type CellLock,
  type LockViolation,
  type MatrixChange,
} from './permission-matrix';

export {
  NO_OVERRIDES,
  PATIENT_ASSIGNMENT_REPOSITORY,
  PATIENT_SELF_REPOSITORY,
  principalOf,
  PERMISSION_CACHE,
  ROLE_REPOSITORY,
  type EffectivePermissions,
  type PatientAssignmentRepository,
  type PatientSelfRepository,
  type CachedPermissions,
  type PermissionCache,
  type PermissionOverrides,
  type Principal,
  type RoleRepository,
} from './authz.types';

export {
  AUTHENTICATED_METADATA,
  Authenticated,
  CAN_METADATA,
  Can,
  IS_PUBLIC_KEY,
  Public,
  ROLES_METADATA,
  Roles,
} from './authz.decorators';
export { AuthorizationGuard } from './authorization.guard';
export { PermissionResolver } from './permission-resolver.service';
export { PatientScopeService } from './patient-scope.service';
export {
  HOSPITAL_CONTEXT_REPOSITORY,
  HospitalContextService,
  type HospitalContextRepository,
} from './hospital-context.service';
export { PatientSelfScopeService } from './patient-self-scope.service';
export {
  ADMIN_SCOPE_REPOSITORY,
  AdminScopeService,
  hospitalFilterOf,
  scopeFromFacts,
  type AdminScope,
  type AdminScopeFacts,
  type AdminScopeRefusal,
  type AdminScopeRepository,
  type ResolvedAdminScope,
} from './admin-scope.service';
export {
  ADMIN_SCOPE_METADATA,
  AdminScopeGuard,
  AdminScoped,
  CurrentAdminScope,
  CurrentAdminScopeOrOtherRole,
  type AdminScopeMode,
  type AdminScopeRule,
} from './admin-scope.guard';
export { AuthzKernelModule } from './authz.module';
