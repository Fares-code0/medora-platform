import type { AnnotatableNote } from './annotation';
import type { OrderableLabRequest } from './ordering';
import type { ReviewableTest } from './review';
import type { PatientLabTrends } from './trends';
import type { LabTest, TestSpec } from './types';

/**
 * The laboratory port — `api/seam.ts`'s pattern, one feature, one port.
 *
 * Two adapters implement it: the session-lifetime mock over the seeded
 * corpus, and the HTTP adapter over API §8 (`http/http-lab-service.ts`,
 * FE-10.7). `service.ts` chooses between them; nothing downstream imports
 * either.
 */
/** The port's one error contract: the id does not resolve to an order. */
export const LAB_NOT_FOUND = 'LAB_NOT_FOUND';

export interface LabService {
  /* ── Reads ─────────────────────────────────────────────────── */
  /** `signal` lets a cancelled query stop an adapter's remaining reads. */
  listLabTests(options?: { readonly signal?: AbortSignal }): Promise<readonly LabTest[]>;
  getLabTest(labId: string): Promise<LabTest>;
  /** The tests that may be ordered (API §8.1). */
  listCatalogue(): Promise<readonly TestSpec[]>;
  /**
   * One patient's released numeric history for up to three analytes
   * (API §8.8, `GET /patients/{id}/lab-trends`). The patient's whole history,
   * not whatever slice of orders a screen happens to have loaded.
   */
  getTrends(patientId: string, analytes: readonly string[]): Promise<PatientLabTrends>;

  /* ── The review loop (D-11) ────────────────────────────────── */
  /**
   * Marks one released result reviewed. Takes `ReviewableTest`, whose only
   * producer is `assessReviewability` — so no caller can reach this method
   * without every critical value acknowledged and explained. Never
   * optimistic: nothing may look reviewed before it is.
   */
  markReviewed(reviewable: ReviewableTest): Promise<LabTest>;
  /**
   * The bulk path (UX §2.6: "bulk allowed only for Normal"). It takes the
   * same unforgeable value per test rather than a list of ids, so the
   * eligibility rule cannot be applied in the UI and skipped in the service.
   */
  markManyReviewed(reviewables: readonly ReviewableTest[]): Promise<readonly LabTest[]>;

  /* ── Annotation (D-15) ─────────────────────────────────────── */
  /**
   * Appends a clinician's note to a result. Takes `AnnotatableNote`, whose
   * only producer is `assessAnnotation`, so an empty or whitespace-only
   * note is unrepresentable rather than merely rejected — the D-11 shape,
   * applied to a much smaller rule.
   *
   * Append-only by design: the port exposes no edit and no delete, so
   * rewriting what a named clinician said about a patient's result is a
   * compile error rather than a missing button.
   */
  annotate(note: AnnotatableNote): Promise<LabTest>;

  /* ── Ordering (DX-23) ──────────────────────────────────────── */
  /**
   * Places an order. Takes `OrderableLabRequest`, whose only producer is
   * `assessOrder`, so an order without a patient, a test or a clinical
   * indication cannot be constructed to pass here.
   *
   * Returns the orders it created — one per test, because the worklist, the
   * review loop and the patient profile are all keyed on a single test.
   */
  orderLabs(request: OrderableLabRequest): Promise<readonly LabTest[]>;

  readonly capabilities: LabServiceCapabilities;
}

export interface LabServiceCapabilities {
  /**
   * Whether result annotations can be written and read. The laboratory API
   * has no annotation endpoint, so the HTTP adapter says no and the screens
   * neither offer the action nor present an empty list as "none written".
   */
  readonly annotations: boolean;
  /** Whether reviews and orders reach the laboratory service. */
  readonly transmits: boolean;
}
