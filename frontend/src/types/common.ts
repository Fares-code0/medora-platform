/**
 * Common utility types — FRONTEND_ARCHITECTURE.md §9.2.
 */

/**
 * Branded id types make cross-entity id swaps a compile error —
 * a clinical-safety measure (§9.2). Create ids only via `brandId`.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type PatientId = Brand<string, 'PatientId'>;
export type DoctorId = Brand<string, 'DoctorId'>;
export type AppointmentId = Brand<string, 'AppointmentId'>;
export type PrescriptionId = Brand<string, 'PrescriptionId'>;
export type LabReportId = Brand<string, 'LabReportId'>;
export type ConversationId = Brand<string, 'ConversationId'>;

/** Cast a raw string (from a DTO or URL param) to a branded id. */
export function brandId<T extends Brand<string, string>>(raw: string): T {
  return raw as T;
}

/** ISO-8601 datetime string, e.g. "2026-07-09T14:30:00Z". */
export type IsoDateTime = Brand<string, 'IsoDateTime'>;

/** ISO date-only string, e.g. "2026-07-09". */
export type IsoDate = Brand<string, 'IsoDate'>;

/** Make selected keys of T required. */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/** Discriminated async value for the rare non-Query async UI. */
export type AsyncValue<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly value: T }
  | { readonly status: 'error'; readonly error: unknown };
