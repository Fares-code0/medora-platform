/**
 * Boundary fixture (RM M2.3) — **this file is supposed to fail lint.**
 *
 * The violation: reaching past `shared/audit`'s index to the concrete
 * dispatcher. M28 replaces that class; a module holding a reference to
 * it would have to be edited when it does, which is exactly what the
 * token indirection exists to prevent.
 */
import { LoggingAuditDispatcher } from '../../../shared/audit/logging-audit.dispatcher';

export const leakedInternal = LoggingAuditDispatcher.name;
