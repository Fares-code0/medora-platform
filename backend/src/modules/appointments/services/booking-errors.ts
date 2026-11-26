/**
 * Recognising the database guards a slot booking relies on (DR-11).
 *
 * The constraint name reaches the application in different places
 * depending on the driver-adapter shape — `meta.target`, the adapter's
 * `cause.constraint.index`, or only the message of a trigger's `RAISE` —
 * so this walks the error and looks for the name anywhere in it, as
 * `isLastPlatformAdminViolation` does for its trigger. A name is a stable
 * identifier the migrations own; matching it is not parsing prose.
 */

export function mentionsConstraint(error: unknown, names: readonly string[]): boolean {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 8 || value === null || value === undefined || seen.has(value)) return false;
    if (typeof value === 'string') return names.some((name) => value.includes(name));
    if (typeof value !== 'object') return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => visit(item, depth + 1));
    const record = value as Record<string, unknown>;
    return [
      'message',
      'originalMessage',
      'cause',
      'meta',
      'driverAdapterError',
      'constraint',
      'index',
      'target',
      'fields',
    ].some((key) => visit(record[key], depth + 1));
  };

  return visit(error, 0);
}

/** The partial unique index: one live booking per published slot. */
export const ONE_BOOKING_PER_SLOT = 'appointments_one_active_booking_per_slot';
/** The exclusion constraint: no overlapping live appointments per doctor. */
export const NO_OVERLAP = 'appointments_no_overlap';
/** The insert trigger: the slot must be unwithdrawn and match the row. */
export const SLOT_AVAILABLE = 'appointments_published_slot_available_check';
/** The insert trigger: the slot's employment must still be active. */
export const ACTIVE_EMPLOYMENT = 'appointments_active_employment_check';
