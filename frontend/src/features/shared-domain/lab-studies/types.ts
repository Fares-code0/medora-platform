import type { StatusKind } from '@/components/patterns';
import type { BloodType, Gender } from '@/features/shared-domain/patient-identity';

/**
 * Laboratory domain model (D-05).
 *
 * **Why this lives in `shared-domain` and not in the labs feature.** The labs
 * module owns the lab *screens*; the patient profile's "Lab results" tab has
 * to list the same orders, and §3.4 forbids one feature reaching into
 * another. Before D-05 the profile rendered its own invented study cards —
 * the defect D-05 names: "the same data exists two floors away and isn't
 * shared". A model both features need is exactly what §3.3 defines this layer
 * for, and it is the same move `conversations/` made when the admin area
 * needed the doctor's threads.
 *
 * **What stayed behind.** `LAB_TIMELINE_META` alone, in
 * `features/doctor/labs/model/types.ts`, because it binds this model to
 * `lucide-react` and only the labs feature draws a timeline. The
 * StatusBadge maps are here rather than there for the same reason the model
 * is: both features render a lab status, and two copies of the mapping is
 * how the profile ends up calling an order "Processing" that the Labs screen
 * calls "Collected". That file re-exports everything below, so no labs
 * module had to change its imports.
 */

/* ── Status ─────────────────────────────────────────────────────── */

export type LabTestStatus = 'ordered' | 'collected' | 'processing' | 'completed' | 'cancelled';

export const LAB_STATUS_META: Record<
  LabTestStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  ordered: { label: 'Ordered', kind: 'pending' },
  collected: { label: 'Collected', kind: 'info' },
  processing: { label: 'Processing', kind: 'active' },
  completed: { label: 'Completed', kind: 'completed' },
  cancelled: { label: 'Cancelled', kind: 'cancelled' },
};

export const LAB_STATUSES = Object.keys(LAB_STATUS_META) as readonly LabTestStatus[];

/** Ordered/collected = still awaiting the lab (summary "Pending" card). */
export const PENDING_LAB_STATUSES: ReadonlySet<LabTestStatus> = new Set(['ordered', 'collected']);
/** Processing = actively in the analyzer (summary "In progress" card). */
export const IN_PROGRESS_LAB_STATUSES: ReadonlySet<LabTestStatus> = new Set(['processing']);

/* ── Priority ───────────────────────────────────────────────────── */

export type LabPriority = 'routine' | 'urgent' | 'stat';

export const LAB_PRIORITY_META: Record<
  LabPriority,
  { readonly label: string; readonly kind: StatusKind }
> = {
  routine: { label: 'Routine', kind: 'normal' },
  urgent: { label: 'Urgent', kind: 'expiring' },
  stat: { label: 'STAT', kind: 'critical' },
};

export const LAB_PRIORITIES = Object.keys(LAB_PRIORITY_META) as readonly LabPriority[];

/* ── Test categories ────────────────────────────────────────────── */

export type LabTestCategory =
  | 'Hematology'
  | 'Chemistry'
  | 'Microbiology'
  | 'Immunology'
  | 'Pathology'
  | 'Urinalysis'
  | 'Hormones'
  | 'Blood Bank';

export const LAB_CATEGORIES: readonly LabTestCategory[] = [
  'Hematology',
  'Chemistry',
  'Microbiology',
  'Immunology',
  'Pathology',
  'Urinalysis',
  'Hormones',
  'Blood Bank',
];

/** Departments that order lab work (shared vocabulary with the filters). */
export const LAB_DEPARTMENTS: readonly string[] = [
  'General Medicine',
  'Cardiology',
  'Endocrinology',
  'Pulmonology',
  'Nephrology',
  'Oncology',
  'Emergency',
];

/* ── Result flags & reference ranges ────────────────────────────── */

export type LabResultFlag =
  | 'normal'
  | 'low'
  | 'high'
  | 'critical-low'
  | 'critical-high'
  | 'abnormal';

export const LAB_RESULT_FLAG_META: Record<
  LabResultFlag,
  { readonly label: string; readonly kind: StatusKind; readonly abbr: string }
> = {
  normal: { label: 'Normal', kind: 'normal', abbr: '—' },
  low: { label: 'Low', kind: 'expiring', abbr: 'L' },
  high: { label: 'High', kind: 'expiring', abbr: 'H' },
  'critical-low': { label: 'Critical low', kind: 'critical', abbr: 'LL' },
  'critical-high': { label: 'Critical high', kind: 'critical', abbr: 'HH' },
  abnormal: { label: 'Abnormal', kind: 'expiring', abbr: 'A' },
};

export function isCriticalFlag(flag: LabResultFlag): boolean {
  return flag === 'critical-low' || flag === 'critical-high';
}

export interface LabReferenceRange {
  /** Lower bound for numeric analytes; null for qualitative results. */
  readonly low: number | null;
  readonly high: number | null;
  /** Human-readable range, e.g. "4.0–11.0" or "Negative". */
  readonly text: string;
}

export interface LabResultItem {
  readonly id: string;
  readonly analyte: string;
  /** Display value — numeric string or a categorical ("Negative", "No growth"). */
  readonly value: string;
  readonly numericValue: number | null;
  readonly unit: string;
  readonly referenceRange: LabReferenceRange;
  readonly flag: LabResultFlag;
}

/* ── Review (D-11) ──────────────────────────────────────────────── */

/**
 * The doctor's review of a released result. UX §2.6 makes review mandatory
 * for critical results, so this is an audit claim rather than a UI flag: it
 * records who reviewed, when, and — where a critical analyte was involved —
 * exactly which ones they acknowledged and why. `model/review.ts` owns the
 * rules; this file owns only the shape the DTO will carry.
 */
export interface LabReview {
  readonly reviewedAt: string;
  readonly reviewedBy: string;
  /**
   * The critical result ids acknowledged at review time. Empty for a result
   * with no critical analyte; never empty when one is present, because the
   * only producer of a reviewable test refuses that combination.
   *
   * `null` when the source does not report them: the laboratory API records
   * the acknowledgment but serves only who reviewed and when (API §8.3).
   */
  readonly acknowledgedCriticalIds: readonly string[] | null;
  /** Required alongside a critical acknowledgment; '' otherwise; `null` when not reported. */
  readonly note: string | null;
}

/* ── Specimen ───────────────────────────────────────────────────── */

export type LabSpecimenType =
  | 'Serum'
  | 'Plasma'
  | 'Whole blood'
  | 'Urine'
  | 'Swab'
  | 'Tissue biopsy'
  | 'Stool'
  | 'Sputum'
  | 'CSF';

export type LabSpecimenCondition = 'Acceptable' | 'Hemolyzed' | 'Clotted' | 'Insufficient volume';

export interface LabSpecimen {
  readonly type: LabSpecimenType;
  readonly container: string;
  readonly collectionSite: string;
  readonly collectedBy: string;
  readonly collectedAt: string;
  readonly receivedAt: string | null;
  readonly condition: LabSpecimenCondition;
  readonly volume: string;
}

/* ── Attachments ────────────────────────────────────────────────── */

export type LabAttachmentKind = 'report' | 'addendum' | 'external' | 'raw-data';

export const LAB_ATTACHMENT_KIND_META: Record<LabAttachmentKind, { readonly label: string }> = {
  report: { label: 'Report' },
  addendum: { label: 'Addendum' },
  external: { label: 'External' },
  'raw-data': { label: 'Raw data' },
};

export interface LabAttachment {
  readonly id: string;
  readonly name: string;
  readonly kind: LabAttachmentKind;
  readonly sizeKb: number;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
}

/* ── Timeline ───────────────────────────────────────────────────── */

export type LabTimelineKind =
  | 'ordered'
  | 'collected'
  | 'received'
  | 'processing'
  | 'resulted'
  | 'verified'
  | 'cancelled';

export interface LabTimelineEvent {
  readonly id: string;
  readonly kind: LabTimelineKind;
  readonly at: string;
  readonly actor: string;
  readonly detail: string;
}

/* ── Annotations (D-15) ─────────────────────────────────────────── */

/**
 * A clinician's note on a released result.
 *
 * Deliberately **not** a timeline event. The timeline is the audit of what
 * the laboratory did to the specimen — ordered, collected, resulted,
 * verified — and every entry there is a fact about process. An annotation is
 * clinical opinion about the finding, written by a person who may not be the
 * one who ordered it. Folding the two together would let a reader mistake
 * a colleague's interpretation for something the lab asserted.
 *
 * Append-only: an annotation is attributed and timestamped, so editing one
 * would silently rewrite what a named clinician said about a patient's
 * result. Nothing in this model removes or amends one.
 */
export interface LabAnnotation {
  readonly id: string;
  /** The note itself. Plain text; nothing here is interpreted as markup. */
  readonly text: string;
  readonly author: string;
  readonly createdAt: string;
  /**
   * The analyte this note is about, or null for the order as a whole. A
   * note about a single potassium value is not a note about the panel.
   */
  readonly resultId: string | null;
  /**
   * States in words that nothing left the browser, rendered verbatim by the
   * UI rather than restated there — the D-11 timeline rule.
   */
  readonly note: string;
}

/* ── The lab test ───────────────────────────────────────────────── */

/** Denormalized patient display fields, as the list DTO will carry them. */
export interface LabPatientSnapshot {
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly age: number;
  readonly gender: Gender;
  readonly bloodType: BloodType;
  readonly phone: string;
}

export interface LabTest {
  readonly id: string;
  readonly patient: LabPatientSnapshot;
  readonly testName: string;
  readonly testCode: string;
  readonly category: LabTestCategory;
  readonly department: string;
  readonly orderedBy: string;
  readonly clinicalIndication: string;
  readonly status: LabTestStatus;
  readonly priority: LabPriority;
  readonly requestedDate: string;
  readonly collectedDate: string | null;
  readonly completedDate: string | null;
  readonly specimen: LabSpecimen | null;
  readonly results: readonly LabResultItem[];
  readonly interpretation: string | null;
  /** Derived: any released result carries a critical flag. */
  readonly hasCriticalResult: boolean;
  /** null until the ordering doctor marks it reviewed (D-11). */
  readonly review: LabReview | null;
  readonly attachments: readonly LabAttachment[];
  /** Clinician notes on this result (D-15). Append-only. */
  readonly annotations: readonly LabAnnotation[];
  readonly timeline: readonly LabTimelineEvent[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Count of released results outside their reference range (table/detail hint). */
export function abnormalResultCount(test: LabTest): number {
  return test.results.filter((result) => result.flag !== 'normal').length;
}
