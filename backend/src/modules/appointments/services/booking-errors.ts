/**
 * Recognising a named database guard in a Prisma / driver-adapter error.
 *
 * Used by slot publishing (`published_slots_active_employment_check`).
 * Patient booking maps its own guards in `patient-booking.service.ts`
 * (ADR-049): any unique violation, including
 * `appointments_one_live_booking_per_slot`, is `409 slot_taken`.
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
