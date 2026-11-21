/**
 * Public API — audit dispatch (RM M2.3, M28.1).
 *
 * The concrete dispatcher is intentionally not exported: modules inject
 * `AUDIT_DISPATCHER` and depend on the interface, which is what let M28
 * replace the implementation without touching a single call site.
 *
 * The taxonomy *is* exported, because M28.3's query surface has to offer
 * the same five categories and three severities the writer files rows
 * under, and two copies of that vocabulary would drift.
 */
export {
  AUDIT_DISPATCHER,
  type AuditActor,
  type AuditDispatcher,
  type AuditEvent,
  type AuditMetadata,
} from './audit.types';
export {
  classify,
  type AuditCategory,
  type AuditSeverity,
  type Classification,
} from './audit-taxonomy';
export { AuditKernelModule } from './audit.module';
export { TransactionalAuditWriter } from './transactional-audit.writer';
