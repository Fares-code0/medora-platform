import type { SortState } from '@/components/ui';
import { dayDiffFromToday } from '@/utils/dates';

import type { PharmacyListFilters } from './filters';
import { PRESCRIPTION_STATUSES, type PrescriptionSummary } from './types';

/**
 * Pure list derivations over the mock dataset: search, filtering,
 * sorting, and the summary-card figures. These become server-side query
 * params when the API lands; components are unaffected either way.
 */

export const PRESCRIPTION_SORT_COLUMNS = [
  'id',
  'patient',
  'mrn',
  'medication',
  'doctor',
  'startDate',
  'endDate',
  'status',
] as const;

export type PrescriptionSortColumn = (typeof PRESCRIPTION_SORT_COLUMNS)[number];

export function isPrescriptionSortColumn(value: string): value is PrescriptionSortColumn {
  return (PRESCRIPTION_SORT_COLUMNS as readonly string[]).includes(value);
}

/** Search across patient name, MRN, prescription id, medication, and doctor. */
function matchesQuery(prescription: PrescriptionSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    prescription.patient.name.toLowerCase().includes(q) ||
    prescription.patient.mrn.toLowerCase().includes(q) ||
    prescription.id.toLowerCase().includes(q) ||
    prescription.medication.name.toLowerCase().includes(q) ||
    prescription.medication.genericName.toLowerCase().includes(q) ||
    prescription.prescribingDoctor.toLowerCase().includes(q)
  );
}

const dateKey = (iso: string) => iso.slice(0, 10);

export function filterPrescriptions(
  prescriptions: readonly PrescriptionSummary[],
  query: string,
  filters: PharmacyListFilters,
): readonly PrescriptionSummary[] {
  return prescriptions.filter((prescription) => {
    if (!matchesQuery(prescription, query)) return false;
    if (filters.patient && prescription.patient.id !== filters.patient) return false;
    if (filters.status && prescription.status !== filters.status) return false;
    if (filters.category && prescription.medication.category !== filters.category) return false;
    if (filters.doctor && prescription.prescribingDoctor !== filters.doctor) return false;
    if (filters.refillStatus && prescription.refillStatus !== filters.refillStatus) return false;
    if (filters.highRisk && !prescription.medication.isHighRisk) return false;
    if (filters.controlled && !prescription.medication.isControlled) return false;
    const startKey = dateKey(prescription.startDate);
    if (filters.from && startKey < filters.from) return false;
    if (filters.to && startKey > filters.to) return false;
    return true;
  });
}

const COMPARATORS: Record<
  PrescriptionSortColumn,
  (a: PrescriptionSummary, b: PrescriptionSummary) => number
> = {
  id: (a, b) => a.id.localeCompare(b.id),
  patient: (a, b) => a.patient.name.localeCompare(b.patient.name),
  mrn: (a, b) => a.patient.mrn.localeCompare(b.patient.mrn),
  medication: (a, b) => a.medication.name.localeCompare(b.medication.name),
  doctor: (a, b) => a.prescribingDoctor.localeCompare(b.prescribingDoctor),
  startDate: (a, b) => a.startDate.localeCompare(b.startDate),
  endDate: (a, b) => a.endDate.localeCompare(b.endDate),
  status: (a, b) =>
    PRESCRIPTION_STATUSES.indexOf(a.status) - PRESCRIPTION_STATUSES.indexOf(b.status),
};

export function sortPrescriptions(
  prescriptions: readonly PrescriptionSummary[],
  sort: SortState | null,
): readonly PrescriptionSummary[] {
  if (!sort || !isPrescriptionSortColumn(sort.columnId)) {
    // Default: most recently prescribed first.
    return [...prescriptions].sort((a, b) => b.startDate.localeCompare(a.startDate));
  }
  const comparator = COMPARATORS[sort.columnId];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...prescriptions].sort((a, b) => sign * comparator(a, b));
}

export interface PharmacySummary {
  readonly total: number;
  readonly active: number;
  readonly pendingRefills: number;
  readonly expired: number;
  readonly highRisk: number;
  readonly newToday: number;
}

/** Summary cards over the whole dataset (not the filtered view). */
export function summarizePrescriptions(
  prescriptions: readonly PrescriptionSummary[],
): PharmacySummary {
  let active = 0;
  let pendingRefills = 0;
  let expired = 0;
  let highRisk = 0;
  let newToday = 0;

  for (const prescription of prescriptions) {
    if (prescription.status === 'active') active += 1;
    if (prescription.status === 'expired') expired += 1;
    if (prescription.refillStatus === 'pending') pendingRefills += 1;
    if (prescription.medication.isHighRisk) highRisk += 1;
    if (dayDiffFromToday(prescription.createdAt) === 0) newToday += 1;
  }

  return {
    total: prescriptions.length,
    active,
    pendingRefills,
    expired,
    highRisk,
    newToday,
  };
}

/**
 * How a prescription may be ended, by its status (DEC-002, ADR-002 §4).
 *
 * The server has two routes that write the same `discontinued` status and
 * differ in what the audit trail records: `/cancel` withdraws a prescription
 * before therapy takes effect, `/discontinue` stops a therapy that has
 * started. Which act it is follows from the status, so the doctor is never
 * asked to choose — and cannot choose the one that would misstate it:
 *
 * - `pending-approval` — signed, not yet in effect → **cancel**.
 * - `active`, `dispensed` — therapy under way → **discontinue**.
 * - `draft` — neither. The server refuses both (409 `draft_not_discontinuable`:
 *   nobody signed it, so it cannot be marked as ended). It is **discarded**
 *   instead (`isDiscardableDraft`, BR-DEC-002) — an unsigned draft dispenses
 *   nothing, so there is no therapy to end and no reason to record.
 * - `completed`, `discontinued`, `expired` — already ended.
 *
 * Lives here rather than beside the menus, so the row menu and the detail
 * page cannot disagree. The server accepts either route from any open,
 * signed status; this is the client's rule for which one it offers.
 */
export type EndAct = 'cancel' | 'discontinue';

/** The menu label for each act — one source for the row menu and the detail page. */
export const END_ACT_LABEL: Readonly<Record<EndAct, string>> = {
  cancel: 'Cancel prescription',
  discontinue: 'Discontinue',
};

/** The menu label for discarding an unsigned server draft (BR-DEC-002). */
export const DISCARD_DRAFT_LABEL = 'Discard draft';

/**
 * Whether to offer Discard (BR-DEC-002, ADR-044): an unsigned draft only. The
 * server also requires that the caller prescribed it; the list a doctor sees
 * is already their own prescriptions (`GET /prescriptions` is prescriber-scoped).
 */
export function isDiscardableDraft(prescription: PrescriptionSummary): boolean {
  return prescription.status === 'draft';
}

export function endActFor(prescription: PrescriptionSummary): EndAct | null {
  switch (prescription.status) {
    case 'pending-approval':
      return 'cancel';
    case 'active':
    case 'dispensed':
      return 'discontinue';
    default:
      return null;
  }
}

/**
 * A renewal is a second course of something that was prescribed, so an
 * unsigned draft — prescribed by nobody — has nothing to renew (API §7.8).
 */
export function isRenewable(prescription: PrescriptionSummary): boolean {
  return prescription.status !== 'draft';
}
