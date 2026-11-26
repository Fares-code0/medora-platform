/**
 * The patient-facing lab *status* projection (contract §4, owner decision
 * 2026-11-26 — ADR-050 draft).
 *
 * Status only. Results, interpretation, flags, the critical marker, the
 * clinical indication and the reviewer are clinician-only and have no field
 * here: the release policy (ADR-031) is not approved, so `results` always
 * says so instead of carrying anything.
 */

export type PatientLabStatus = 'awaiting_collection' | 'in_progress' | 'completed' | 'cancelled';

export interface PatientLabOrderView {
  readonly id: string;
  readonly testName: string;
  readonly category: string;
  readonly specimenType: string;
  readonly status: PatientLabStatus;
  readonly requestedAt: string;
  readonly collectedAt: string | null;
  readonly completedAt: string | null;
  readonly hospital: { readonly id: string; readonly name: string } | null;
  readonly results: { readonly available: false; readonly reason: 'release_policy_pending' };
}

export interface PatientLabOrderPage {
  readonly items: readonly PatientLabOrderView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}
