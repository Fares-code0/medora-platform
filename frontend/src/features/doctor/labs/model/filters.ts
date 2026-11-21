import type { ActiveFilter } from '@/components/patterns';
import { formatDate } from '@/utils/dates';

import {
  LAB_PRIORITY_META,
  LAB_STATUS_META,
  type LabPriority,
  type LabTestCategory,
  type LabTestStatus,
} from './types';

/**
 * Laboratory list filter contract — mirrors the URL params for
 * /doctor/labs so every filtered view is shareable and restorable.
 * `null` = filter not applied. `patient` is the deep-link filter used by
 * the Patient Profile and Medical Records "Lab results" entry points.
 *
 * `flag` and `review` are D-10's two additions, and they are the two the
 * UX §2.6 toolbar names that the Phase-7 build never had. `flag` replaced a
 * `critical` boolean: one three-valued control beats a select plus a toggle
 * that overlap on one of the three values, and `?critical=1` is still read as
 * `flag=critical` so links written before the change still resolve.
 */
export interface LabListFilters {
  readonly status: LabTestStatus | null;
  readonly category: LabTestCategory | null;
  readonly priority: LabPriority | null;
  readonly department: string | null;
  readonly doctor: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly flag: LabFlagFilter | null;
  readonly review: LabReviewFilter | null;
  readonly patient: string | null;
}

/**
 * Result-flag bands, as a reader thinks of them rather than as the six
 * `LabResultFlag` values: "is anything out of range, and is any of it
 * dangerous". Low/High/Abnormal collapse into `abnormal` deliberately —
 * a doctor filtering a worklist wants the boundary, not the direction.
 */
export type LabFlagFilter = 'normal' | 'abnormal' | 'critical';

export const LAB_FLAG_FILTER_META: Record<LabFlagFilter, { readonly label: string }> = {
  normal: { label: 'All within range' },
  abnormal: { label: 'Any abnormal value' },
  critical: { label: 'Critical value' },
};

export const LAB_FLAG_FILTERS = Object.keys(LAB_FLAG_FILTER_META) as readonly LabFlagFilter[];

/** UX §2.6's "review status" filter. */
export type LabReviewFilter = 'unreviewed' | 'reviewed';

export const LAB_REVIEW_FILTER_META: Record<LabReviewFilter, { readonly label: string }> = {
  unreviewed: { label: 'Awaiting review' },
  reviewed: { label: 'Reviewed' },
};

export const LAB_REVIEW_FILTERS = Object.keys(
  LAB_REVIEW_FILTER_META,
) as readonly LabReviewFilter[];

/** YYYY-MM-DD guard for the date-range params. */
export function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * `patientName` resolves the `patient` filter's id for its chip — from the
 * orders on screen, which carry their patient's name — and falls back to
 * the id itself.
 */
export function toActiveFilterChips(
  filters: LabListFilters,
  patientName: (patientId: string) => string | undefined = () => undefined,
): readonly ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  if (filters.patient) {
    chips.push({
      id: 'patient',
      label: `Patient: ${patientName(filters.patient) ?? filters.patient}`,
    });
  }
  if (filters.status) {
    chips.push({ id: 'status', label: `Status: ${LAB_STATUS_META[filters.status].label}` });
  }
  if (filters.category) chips.push({ id: 'category', label: `Category: ${filters.category}` });
  if (filters.priority) {
    chips.push({ id: 'priority', label: `Priority: ${LAB_PRIORITY_META[filters.priority].label}` });
  }
  if (filters.department) chips.push({ id: 'department', label: `Department: ${filters.department}` });
  if (filters.doctor) chips.push({ id: 'doctor', label: `Ordered by: ${filters.doctor}` });
  if (filters.from) chips.push({ id: 'from', label: `From: ${formatDate(filters.from)}` });
  if (filters.to) chips.push({ id: 'to', label: `To: ${formatDate(filters.to)}` });
  if (filters.flag) {
    chips.push({ id: 'flag', label: `Flag: ${LAB_FLAG_FILTER_META[filters.flag].label}` });
  }
  if (filters.review) {
    chips.push({ id: 'review', label: `Review: ${LAB_REVIEW_FILTER_META[filters.review].label}` });
  }
  return chips;
}
