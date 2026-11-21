/**
 * The lab order (API §8.2, §8.3).
 *
 * Field names are the frontend's `LabTest` verbatim —
 * `shared-domain/lab-studies/types.ts` is the type the worklist, the
 * detail page and the patient profile's Lab-results tab already render,
 * and the contract's §11 header makes those literals law. That is why
 * this reads `requestedDate` rather than `requestedAt` and `testName`
 * rather than `name`: the column is `requested_at`, the client calls it
 * `requestedDate`, and the projection is where the two meet.
 *
 * ## What is added, and why each addition is forced
 *
 *  - **`id` is the `LAB-…` reference**, as it is on the frontend. The
 *    uuid never leaves the server; every route quotes the handle.
 *  - **`reviewStatus`** — the frontend derives it from `review === null`
 *    plus `results.length`, which works on a model that always carries
 *    every result. §8.2's list carries **summary counts** rather than
 *    the result array (a worklist page with every analyte on every row
 *    is a payload nobody reads), so the state has to be sent rather than
 *    inferred, or the list would grade every row `not-required`.
 *  - **`resultSummary`** — §8.2 says "result summary counts" in as many
 *    words: how many values, how many abnormal, how many critical.
 *  - **`patient.id` is the `PT-…` handle**, matching every other module.
 *
 * ## `review` is nullable and its note may be empty
 *
 * `LabReview` on the frontend carries `acknowledgedCriticalIds` and a
 * `note`. The database has `lab_orders.reviewed_at` and `reviewed_by`
 * and nothing else — DB §E3 has no acknowledgment columns, the way DB
 * §F4 has them for a prescription's warnings. So the *evidence* of a
 * critical acknowledgment is written to the audit log (module 14), which
 * is where a reason for a clinical act belongs and is queryable, and the
 * view reports what the row can hold. See D-14.1: closing the gap is a
 * schema change and not this milestone's to make.
 */

export interface LabPatientSnapshotView {
  /** `PT-…`. */
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly age: number;
  readonly gender: string;
  readonly bloodType: string;
  readonly phone: string;
}

export interface LabReferenceRangeView {
  /** Null for a qualitative analyte. */
  readonly low: number | null;
  readonly high: number | null;
  /** `"4.0–11.0"`, or the normal option. Snapshotted at result time. */
  readonly text: string;
}

export interface LabResultItemView {
  readonly id: string;
  readonly analyte: string;
  /** As reported — a numeric string or a categorical value. */
  readonly value: string;
  readonly numericValue: number | null;
  readonly unit: string;
  readonly referenceRange: LabReferenceRangeView;
  readonly flag: string;
  readonly resultedAt: string;
}

export interface LabSpecimenView {
  readonly type: string;
  readonly container: string;
  readonly collectionSite: string;
  readonly collectedBy: string;
  readonly collectedAt: string;
  readonly receivedAt: string | null;
  readonly condition: string;
  readonly volume: string;
}

export interface LabAttachmentView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly sizeKb: number;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
}

export interface LabTimelineEventView {
  readonly id: string;
  readonly kind: string;
  readonly at: string;
  readonly actor: string;
  readonly detail: string;
}

export interface LabReviewView {
  readonly reviewedAt: string;
  readonly reviewedBy: string;
}

/** §8.2 — "result summary counts". */
export interface LabResultSummaryView {
  readonly total: number;
  readonly abnormal: number;
  readonly critical: number;
}

export interface LabOrderView {
  /** `LAB-…`. */
  readonly id: string;
  readonly patient: LabPatientSnapshotView;
  readonly testName: string;
  readonly testCode: string;
  readonly category: string;
  readonly department: string | null;
  readonly orderedBy: string;
  readonly clinicalIndication: string;
  readonly status: string;
  readonly priority: string;
  readonly requestedDate: string;
  readonly collectedDate: string | null;
  readonly completedDate: string | null;
  /** Trigger-maintained (M5.10); never written by hand. */
  readonly hasCriticalResult: boolean;
  readonly resultSummary: LabResultSummaryView;
  /** `not-required` | `unreviewed` | `reviewed`. */
  readonly reviewStatus: string;
  readonly review: LabReviewView | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LabOrderDetailView extends LabOrderView {
  readonly specimen: LabSpecimenView | null;
  readonly results: readonly LabResultItemView[];
  /** Only ever present on a completed order (M5.8 CHECK). */
  readonly interpretation: string | null;
  readonly attachments: readonly LabAttachmentView[];
  readonly timeline: readonly LabTimelineEventView[];
}

/** §8.10 — the header cards, including the chip the whole module serves. */
export interface LabSummaryView {
  readonly total: number;
  readonly pending: number;
  readonly inProgress: number;
  readonly completed: number;
  readonly cancelled: number;
  /** The "Critical unreviewed: N" chip. Poll-friendly and indexed. */
  readonly criticalUnreviewed: number;
  readonly unreviewed: number;
}

/** §8.7 — what a bulk review refused, and why, per order. */
export interface LabReviewRefusalView {
  readonly id: string;
  readonly reason: string;
  readonly message: string;
}
