/**
 * The audit-column helpers (RM M4.2).
 *
 * Every mutating repository call sets `createdBy`/`updatedBy`, and every
 * delete sets `deletedAt`. Three tiny functions rather than a convention
 * everyone remembers, because "remember to set updatedBy" is a rule that
 * holds for about two months.
 *
 * These are the *row's* audit columns — who last touched it. They are
 * not a substitute for `shared/audit`, which records what happened and
 * survives the row being changed again. A row says who edited it last;
 * the audit log says who edited it ever. HIPAA needs the second.
 */

/**
 * `null` means the platform itself acted — a scheduled job, a retention
 * sweep, an outbox worker. It never means "unknown": a row whose actor
 * could not be determined is a defect, matching how `shared/audit`
 * models `AuditActor.userId`.
 */
export type ActorId = string | null;

export interface CreateAuditColumns {
  readonly createdBy: ActorId;
  readonly updatedBy: ActorId;
}

export interface UpdateAuditColumns {
  readonly updatedBy: ActorId;
}

export interface SoftDeleteColumns {
  readonly deletedAt: Date;
  readonly updatedBy: ActorId;
}

/** Spread into a `create`. Sets both columns — a new row was updated by whoever made it. */
export function auditCreate(actorId: ActorId): CreateAuditColumns {
  return { createdBy: actorId, updatedBy: actorId };
}

/** Spread into an `update`. Never touches `createdBy`. */
export function auditUpdate(actorId: ActorId): UpdateAuditColumns {
  return { updatedBy: actorId };
}

/**
 * Spread into an `update` to soft-delete.
 *
 * A delete is an update, so it carries `updatedBy` too — otherwise the
 * row would show the last *editor* as the last person to touch it, and
 * "who deleted this record" is precisely the question asked of a
 * deleted clinical record.
 *
 * `now` is injectable so tests can assert an exact timestamp rather than
 * a range.
 */
export function auditSoftDelete(actorId: ActorId, now: Date = new Date()): SoftDeleteColumns {
  return { deletedAt: now, updatedBy: actorId };
}
