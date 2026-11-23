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
export { conflictingFields, isLockNotGranted, isUniqueViolation } from './prisma-errors';
export { PrismaService } from './prisma.service';
export {
  type HospitalTenantTransactionOptions,
  type InteractiveTransactionRunner,
  TENANT_HOSPITAL_SETTING,
  withHospitalTenantContext,
} from './hospital-tenant-transaction';
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
