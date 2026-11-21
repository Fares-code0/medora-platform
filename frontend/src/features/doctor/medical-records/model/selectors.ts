import type { SortState } from '@/components/ui';
import { dayDiffFromToday } from '@/utils/dates';

import type { MedicalRecordListFilters } from './filters';
import {
  OPEN_RECORD_STATUSES,
  RECORD_PRIORITIES,
  RECORD_STATUSES,
  primaryDiagnosis,
  type MedicalRecordSummary,
} from './types';

/**
 * Pure list derivations over the mock dataset: search, filtering,
 * sorting, and the summary-card figures. Becomes server-side query
 * params when the API lands; components are unaffected either way.
 */

export const RECORD_SORT_COLUMNS = [
  'id',
  'patient',
  'mrn',
  'visitDate',
  'diagnosis',
  'department',
  'status',
  'priority',
  'updatedAt',
] as const;

export type RecordSortColumn = (typeof RECORD_SORT_COLUMNS)[number];

export function isRecordSortColumn(value: string): value is RecordSortColumn {
  return (RECORD_SORT_COLUMNS as readonly string[]).includes(value);
}

/** Search across patient name, MRN, record id, diagnosis, and doctor. */
function matchesQuery(record: MedicalRecordSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (record.patient.name.toLowerCase().includes(q)) return true;
  if (record.patient.mrn.toLowerCase().includes(q)) return true;
  if (record.id.toLowerCase().includes(q)) return true;
  if (record.doctor.toLowerCase().includes(q)) return true;
  return record.diagnoses.some(
    (diagnosis) =>
      diagnosis.label.toLowerCase().includes(q) || diagnosis.code.toLowerCase().includes(q),
  );
}

const dateKey = (iso: string) => iso.slice(0, 10);

export function filterRecords(
  records: readonly MedicalRecordSummary[],
  query: string,
  filters: MedicalRecordListFilters,
): readonly MedicalRecordSummary[] {
  return records.filter((record) => {
    if (!matchesQuery(record, query)) return false;
    if (filters.patient && record.patient.id !== filters.patient) return false;
    if (filters.status && record.status !== filters.status) return false;
    if (
      filters.diagnosis &&
      !record.diagnoses.some((diagnosis) => diagnosis.label === filters.diagnosis)
    ) {
      return false;
    }
    if (filters.department && record.department !== filters.department) return false;
    if (filters.doctor && record.doctor !== filters.doctor) return false;
    if (filters.visitType && record.visitType !== filters.visitType) return false;
    if (filters.priority && record.priority !== filters.priority) return false;
    const visitKey = dateKey(record.visitDate);
    if (filters.from && visitKey < filters.from) return false;
    if (filters.to && visitKey > filters.to) return false;
    return true;
  });
}

const COMPARATORS: Record<
  RecordSortColumn,
  (a: MedicalRecordSummary, b: MedicalRecordSummary) => number
> = {
  id: (a, b) => a.id.localeCompare(b.id),
  patient: (a, b) => a.patient.name.localeCompare(b.patient.name),
  mrn: (a, b) => a.patient.mrn.localeCompare(b.patient.mrn),
  visitDate: (a, b) => a.visitDate.localeCompare(b.visitDate),
  diagnosis: (a, b) =>
    (primaryDiagnosis(a)?.label ?? '').localeCompare(primaryDiagnosis(b)?.label ?? ''),
  department: (a, b) => a.department.localeCompare(b.department),
  status: (a, b) => RECORD_STATUSES.indexOf(a.status) - RECORD_STATUSES.indexOf(b.status),
  priority: (a, b) => RECORD_PRIORITIES.indexOf(a.priority) - RECORD_PRIORITIES.indexOf(b.priority),
  updatedAt: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
};

export function sortRecords(
  records: readonly MedicalRecordSummary[],
  sort: SortState | null,
): readonly MedicalRecordSummary[] {
  if (!sort || !isRecordSortColumn(sort.columnId)) {
    // Default: most recent visit first.
    return [...records].sort((a, b) => b.visitDate.localeCompare(a.visitDate));
  }
  const comparator = COMPARATORS[sort.columnId];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => sign * comparator(a, b));
}

export interface MedicalRecordsSummary {
  readonly total: number;
  readonly open: number;
  readonly closed: number;
  readonly critical: number;
  readonly createdToday: number;
}

/** Summary cards over the whole dataset (not the filtered view). */
export function summarizeRecords(records: readonly MedicalRecordSummary[]): MedicalRecordsSummary {
  let open = 0;
  let closed = 0;
  let critical = 0;
  let createdToday = 0;

  for (const record of records) {
    if (OPEN_RECORD_STATUSES.has(record.status)) open += 1;
    else closed += 1;
    if (record.priority === 'critical') critical += 1;
    if (dayDiffFromToday(record.createdAt) === 0) createdToday += 1;
  }

  return { total: records.length, open, closed, critical, createdToday };
}
