/**
 * The audit event contract (RM M2.3, working rule 5, API §14).
 *
 * Rule 5 of the roadmap requires every audited mutation to write an
 * audit event, and says earlier milestones "stub through the same
 * interface" that M28 implements. That interface is this file. Fixing
 * the shape now is the whole point: eighteen modules will call
 * `record()` before M28 exists, and none of them should need editing
 * when the real dispatcher lands behind the token.
 */

/**
 * Who acted. `null` is the system itself — a scheduled job, a retention
 * sweep, an outbox worker. It is never "unknown": an audit row whose
 * actor could not be determined is a defect, not a system action.
 */
export interface AuditActor {
  readonly userId: string | null;
  /** Role at the time of the action, not the role read back later. */
  readonly role: string | null;
  readonly ipAddress?: string;
  /**
   * `sessions.id`, when the call site has it (M28.1).
   *
   * Optional, and added *after* seventy call sites existed — which is
   * why it is optional rather than required. §14.2's "same session"
   * correlation uses it where present; where absent, correlation falls
   * back to the same actor within ±5 minutes, which is the other half of
   * what §14.2 asks for and needs no call site to cooperate.
   *
   * Deliberately **not** a foreign key in the schema either: `sessions`
   * rows are purged, and an audit event whose session vanished must keep
   * the id it correlated on.
   */
  readonly sessionId?: string;
}

/**
 * Free-form context. Deliberately restricted to primitives and
 * deliberately **not** a place for clinical content: audit rows record
 * *that* a record was read or changed, never what it said (MG §11.6,
 * DB §10). Field names belong here; field values do not.
 */
export type AuditMetadata = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditEvent {
  /** Dotted `entity.verb`, e.g. `appointment.cancel`, `patient.view`. */
  readonly action: string;
  readonly actor: AuditActor;
  /** The entity type as the API names it, e.g. `appointment`. */
  readonly entityType: string;
  readonly entityId: string;
  /** Ties the audit row to the request's log lines (API §0.1). */
  readonly correlationId?: string;
  /**
   * The hospital the event belongs to (multi-hospital §2.13): the tenant
   * whose data or staff the action touched. `null`/absent for platform-wide
   * events. Persisted to `audit_events.hospital_id`.
   */
  readonly hospitalId?: string | null;
  readonly metadata?: AuditMetadata;
  /** Defaults to now at write time; set it when replaying. */
  readonly occurredAt?: Date;
}

/**
 * Implemented by the stub below until M28 replaces it with the durable
 * writer.
 *
 * `record()` resolves rather than throwing when the sink is unavailable.
 * An audit sink that can fail a clinical write turns an observability
 * dependency into an availability one — M28 makes durability the
 * dispatcher's problem (outbox row in the mutation's transaction), not
 * the caller's.
 */
export interface AuditDispatcher {
  record(event: AuditEvent): Promise<void>;
}

/** DI token — inject the interface, never a concrete class. */
export const AUDIT_DISPATCHER = Symbol('AUDIT_DISPATCHER');
