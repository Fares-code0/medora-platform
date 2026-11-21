import type { SortState } from '@/components/ui';
import { dayDiffFromToday } from '@/utils/dates';

import type { LabListFilters } from './filters';
import { criticalUnreviewedCount, hasReleasedResults, inboxTests, reviewState } from './review';
import {
  IN_PROGRESS_LAB_STATUSES,
  LAB_PRIORITIES,
  LAB_STATUSES,
  PENDING_LAB_STATUSES,
  isCriticalFlag,
  type LabTest,
} from './types';

/**
 * Pure list derivations over the mock dataset: search, filtering,
 * sorting, and the summary-card figures. These become server-side query
 * params when the API lands; components are unaffected either way.
 */

export const LAB_SORT_COLUMNS = [
  'id',
  'patient',
  'mrn',
  'testName',
  'category',
  'orderedBy',
  'requestedDate',
  'completedDate',
  'status',
  'priority',
] as const;

export type LabSortColumn = (typeof LAB_SORT_COLUMNS)[number];

export function isLabSortColumn(value: string): value is LabSortColumn {
  return (LAB_SORT_COLUMNS as readonly string[]).includes(value);
}

/** Search across patient name, MRN, lab id, test name, and ordering doctor. */
function matchesQuery(test: LabTest, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    test.patient.name.toLowerCase().includes(q) ||
    test.patient.mrn.toLowerCase().includes(q) ||
    test.id.toLowerCase().includes(q) ||
    test.testName.toLowerCase().includes(q) ||
    test.testCode.toLowerCase().includes(q) ||
    test.orderedBy.toLowerCase().includes(q)
  );
}

const dateKey = (iso: string) => iso.slice(0, 10);

/**
 * The flag bands, applied to the released results. An order with nothing
 * released matches none of the three — "all within range" is a claim about
 * values, and a test with no values has not made it.
 */
function matchesFlag(test: LabTest, flag: NonNullable<LabListFilters['flag']>): boolean {
  if (!hasReleasedResults(test)) return false;
  switch (flag) {
    case 'critical':
      return test.results.some((result) => isCriticalFlag(result.flag));
    case 'abnormal':
      return test.results.some((result) => result.flag !== 'normal');
    case 'normal':
      return test.results.every((result) => result.flag === 'normal');
  }
}

export function filterLabTests(
  tests: readonly LabTest[],
  query: string,
  filters: LabListFilters,
): readonly LabTest[] {
  return tests.filter((test) => {
    if (!matchesQuery(test, query)) return false;
    if (filters.patient && test.patient.id !== filters.patient) return false;
    if (filters.status && test.status !== filters.status) return false;
    if (filters.category && test.category !== filters.category) return false;
    if (filters.priority && test.priority !== filters.priority) return false;
    if (filters.department && test.department !== filters.department) return false;
    if (filters.doctor && test.orderedBy !== filters.doctor) return false;
    if (filters.flag !== null && !matchesFlag(test, filters.flag)) return false;
    if (filters.review !== null && reviewState(test) !== filters.review) return false;
    const requestedKey = dateKey(test.requestedDate);
    if (filters.from && requestedKey < filters.from) return false;
    if (filters.to && requestedKey > filters.to) return false;
    return true;
  });
}

/** Null-safe date compare — nulls (not-yet-completed) sort last ascending. */
function compareNullableDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

const COMPARATORS: Record<LabSortColumn, (a: LabTest, b: LabTest) => number> = {
  id: (a, b) => a.id.localeCompare(b.id),
  patient: (a, b) => a.patient.name.localeCompare(b.patient.name),
  mrn: (a, b) => a.patient.mrn.localeCompare(b.patient.mrn),
  testName: (a, b) => a.testName.localeCompare(b.testName),
  category: (a, b) => a.category.localeCompare(b.category),
  orderedBy: (a, b) => a.orderedBy.localeCompare(b.orderedBy),
  requestedDate: (a, b) => a.requestedDate.localeCompare(b.requestedDate),
  completedDate: (a, b) => compareNullableDate(a.completedDate, b.completedDate),
  status: (a, b) => LAB_STATUSES.indexOf(a.status) - LAB_STATUSES.indexOf(b.status),
  priority: (a, b) => LAB_PRIORITIES.indexOf(a.priority) - LAB_PRIORITIES.indexOf(b.priority),
};

export function sortLabTests(
  tests: readonly LabTest[],
  sort: SortState | null,
): readonly LabTest[] {
  if (!sort || !isLabSortColumn(sort.columnId)) {
    // Default: most recently requested first.
    return [...tests].sort((a, b) => b.requestedDate.localeCompare(a.requestedDate));
  }
  const comparator = COMPARATORS[sort.columnId];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...tests].sort((a, b) => sign * comparator(a, b));
}

export interface LabTestsSummary {
  readonly total: number;
  readonly pending: number;
  readonly inProgress: number;
  readonly completed: number;
  readonly critical: number;
  readonly newToday: number;
  /** D-10: how many released results are waiting on the doctor. */
  readonly awaitingReview: number;
  /** D-12: the figure the pinned alert chip reads. */
  readonly criticalUnreviewed: number;
}

/** Summary cards over the whole dataset (not the filtered view). */
export function summarizeLabTests(tests: readonly LabTest[]): LabTestsSummary {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  let critical = 0;
  let newToday = 0;

  for (const test of tests) {
    if (test.status === 'completed') completed += 1;
    else if (IN_PROGRESS_LAB_STATUSES.has(test.status)) inProgress += 1;
    else if (PENDING_LAB_STATUSES.has(test.status)) pending += 1;

    // Released criticals only, as the flag filter and the review queue count.
    if (test.hasCriticalResult && test.status === 'completed') critical += 1;
    if (dayDiffFromToday(test.requestedDate) === 0) newToday += 1;
  }

  return {
    total: tests.length,
    pending,
    inProgress,
    completed,
    critical,
    newToday,
    /*
     * Derived from the same array the tabs and the chip read, not counted
     * separately here — a second count is a second thing that can disagree
     * with the tab it labels.
     */
    awaitingReview: inboxTests(tests).length,
    criticalUnreviewed: criticalUnreviewedCount(tests),
  };
}
