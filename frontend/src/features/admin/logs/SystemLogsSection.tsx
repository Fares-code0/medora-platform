import { useState } from 'react';

import { ArrowRight } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { Pagination, Select } from '@/components/ui';
import { routes } from '@/routes';

import { SectionShell } from '../components/SectionShell';

import { useLogActors, useLogPage } from './api/useLogsQueries';
import { LogDetailDrawer } from './LogDetailDrawer';
import { LogExportMenu } from './LogExportMenu';
import { LogFiltersBar, chooseOption } from './LogFiltersBar';
import { PAGE_SIZE, RETENTION_DAYS, filtersFromSearch, pivotOn, type PivotField } from './logs';
import type { LogEvent, LogFilters, SortOrder } from './logs.types';
import { LogTable } from './LogTable';
import { SavedViewsMenu } from './SavedViewsMenu';

/**
 * System Logs (ADM-07 · UX §3.7) — one aggregated event stream, paged.
 *
 * The page owns `filters`, `sort` and `page`, and holds exactly one page of
 * rows: `useLogPage` asks the service for a window, and the service filters,
 * sorts and counts on its own side of the seam. Nothing here slices a corpus
 * it is keeping in memory, because a real log is far larger than one.
 *
 * Every state change that can shrink the result set puts the reader back on
 * page 1. Leaving an investigator on page 7 of a two-page result shows an
 * empty table, which reads as "no matches" rather than "wrong page".
 */

/**
 * Typed, so a typo is a compile error here rather than an invalid sort the
 * service quietly reads as "oldest". `chooseOption` narrows the string back
 * on the way out — see its note on why the obvious `as SortOrder` is worse.
 */
const SORT_OPTIONS: readonly { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

export function SystemLogsSection() {
  /**
   * `?type=`, `?severity=` and `?actor=` arrive from ADM-01's "Investigate",
   * so an alert lands on the events that are its evidence rather than on the
   * whole log — UX §3.1's cross-link into §3.7. Read once, as the initial
   * filters: the URL seeds the view, it does not own it, the same contract
   * `?doctor=` has on appointment oversight and `?tab=` on doctors. Every
   * seeded filter is therefore visible in the bar and clearable from it.
   *
   * Validation lives in `filtersFromSearch`, beside the unions it checks
   * against — see its note on why an unrecognised value is dropped rather
   * than cast.
   */
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<LogFilters>(() => filtersFromSearch(searchParams));
  const [sort, setSort] = useState<SortOrder>('newest');
  /** 1-based, matching `Pagination`; the service takes an offset. */
  const [page, setPage] = useState(1);
  /** The row whose drawer is open, or `null` when none is. */
  const [detail, setDetail] = useState<LogEvent | null>(null);

  const logPage = useLogPage(filters, sort, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const actors = useLogActors();

  /**
   * The one way filters change, whether the reader used the bar or clicked a
   * value in a row. Both paths go back to page 1 — see the note above on why
   * a page number that outlives its result set reads as "no matches".
   */
  const applyFilters = (next: LogFilters) => {
    setFilters(next);
    setPage(1);
  };

  const handlePivot = (field: PivotField, value: string) => {
    applyFilters(pivotOn(filters, field, value));
  };

  return (
    <SectionShell
      slug="logs"
      actions={
        <Select
          options={SORT_OPTIONS}
          value={sort}
          onChange={(value) => {
            setSort(chooseOption(SORT_OPTIONS, value, 'newest'));
            // A re-sort reorders the whole result, so page 3 of the old order
            // is not page 3 of the new one.
            setPage(1);
          }}
          aria-label="Sort order"
          containerClassName="sm:w-44"
        />
      }
      toolbar={
        <LogFiltersBar
          filters={filters}
          onChange={applyFilters}
          actors={actors.data ?? []}
          actions={
            <>
              {/*
               * A saved view replaces the filter set rather than patching it,
               * and goes through `applyFilters` like every other change — so
               * it lands on page 1 of its own result, not page 7 of the last
               * one.
               */}
              <SavedViewsMenu filters={filters} onApply={applyFilters} />
              {/*
               * The same `filters` object the table was drawn from. The export
               * is a record of what an administrator took out of the platform,
               * so it has to be the rows they were looking at.
               */}
              <LogExportMenu filters={filters} />
            </>
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-caption text-text-secondary">
            Entries are retained for {RETENTION_DAYS} days. The log is read-only — no event can be
            edited or deleted, by anyone, including administrators. Timestamps are shown in this
            computer&rsquo;s time zone, the same one the date filters read.
          </p>
          {/*
           * Alert rules are configured in ADM-09 Security, not here (design
           * §11): this page shows what happened, the policy decides what is
           * worth raising an alert about. Stated as a link rather than left
           * implicit, so the division reads as a boundary an investigator can
           * cross rather than a control that is missing.
           */}
          <Link
            to={routes.admin.settings('security')}
            className="inline-flex w-fit items-center gap-1 rounded text-caption text-text-secondary transition-colors duration-fast hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            Configure alert rules in Security settings
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Link>
        </div>

        <LogTable
          rows={logPage.data?.rows ?? []}
          isLoading={logPage.isLoading}
          isError={logPage.isError}
          onRetry={() => void logPage.refetch()}
          onPivot={handlePivot}
          onOpen={setDetail}
        />

        {/*
         * The pager waits for the first page rather than rendering against a
         * total of 0: "Showing 0–0 of 0" beside a loading table is a count,
         * and it would be the wrong one.
         */}
        {logPage.data === undefined ? null : (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={logPage.data.total}
            onPageChange={setPage}
          />
        )}

        {/*
         * Mounted only while there is an event to show, and keyed by its id:
         * a drawer that outlived its row would keep the previous event's raw
         * JSON open behind the next one, and a `<dialog>` left in the tree is
         * one more dialog for a reader's assistive technology to walk past.
         */}
        {detail === null ? null : (
          <LogDetailDrawer
            key={detail.id}
            event={detail}
            onClose={() => {
              setDetail(null);
            }}
          />
        )}
      </div>
    </SectionShell>
  );
}
