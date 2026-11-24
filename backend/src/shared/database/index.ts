/**
 * Public API — database access (RM M4).
 *
 * The generated Prisma client is deliberately not re-exported here.
 * Modules import their own model types from `generated/prisma` directly;
 * funnelling every one of ~110 model types through this barrel would
 * make it the widest import in the codebase and rebuild half the app on
 * any schema change.
 */
export { DatabaseModule } from './database.module';
export {
  conflictingFields,
  isLastPlatformAdminViolation,
  isLockNotGranted,
  isUniqueViolation,
} from './prisma-errors';
export { PrismaService } from './prisma.service';
export {
  applySoftDeleteFilter,
  FILTERED_READ_OPERATIONS,
  ONLY_DELETED,
  type SoftDeletedClient,
  softDeletableModelsOf,
  withSoftDelete,
} from './soft-delete';
export {
  type ActorId,
  auditCreate,
  auditSoftDelete,
  auditUpdate,
  type CreateAuditColumns,
  type SoftDeleteColumns,
  type UpdateAuditColumns,
} from './audit-columns';
export { hospitalStampFor, type HospitalStamp, type StampClient } from './hospital-stamp';
export {
  currentTenantContext,
  runAsSystem,
  runInTenantScope,
  runWithTenantContext,
  setTenantContext,
  type TenantContext,
  type TenantScope,
} from './tenant-context';
