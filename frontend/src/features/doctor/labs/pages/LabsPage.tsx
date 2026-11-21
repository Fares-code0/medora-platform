import { useCallback, useEffect, useMemo, useState } from 'react';

import { CheckCheck, Download, FlaskConical, RefreshCw, SearchX, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useToast } from '@/app/providers';
import { EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { ExportButton, FilterBar, SearchBar } from '@/components/patterns';
import { Breadcrumb, Button, DataTable, IconButton, Pagination, Tabs, Tooltip } from '@/components/ui';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatDate } from '@/i18n';
import { routes } from '@/routes';
import { runExport, type ExportDataset } from '@/utils/export';
import { pageSlice } from '@/utils/pagination';

import { useLabTestsQuery } from '../api/useLabTestsQuery';
import { AnalyteTrendDrawer } from '../components/AnalyteTrendDrawer';
import { AnnotateResultDialog } from '../components/AnnotateResultDialog';
import { AttachToRecordDialog } from '../components/AttachToRecordDialog';
import { BulkReviewDialog } from '../components/BulkReviewDialog';
import { CriticalUnreviewedAlert } from '../components/CriticalUnreviewedAlert';
import { labRowClassName } from '../components/lab-row-tint';
import { buildLabColumns } from '../components/lab-table-columns';
import { LabCardList } from '../components/LabCardList';
import { LabFiltersDrawer } from '../components/LabFiltersDrawer';
import { LabSummaryCards } from '../components/LabSummaryCards';
import { MarkReviewedDialog } from '../components/MarkReviewedDialog';
import { useLabListState } from '../hooks/useLabListState';
import { useLabReviewActions } from '../hooks/useLabReviewActions';
import { toActiveFilterChips } from '../model/filters';
import { LAB_REVIEW_META, inboxTests, reviewState, sortInbox } from '../model/review';
import { filterLabTests, sortLabTests, summarizeLabTests } from '../model/selectors';
import { type LabTest } from '../model/types';
import { labService } from '../service';

/**
 * Laboratory list — the P1 enterprise lab-management surface: URL-owned
 * search/filters/sort/pagination over the lab dataset, summary cards,
 * active filter chips, and a sticky-header DataTable (stacked cards under
 * md). Rows open the full lab result detail page.
 *
 * **D-10 gave it the two tabs UX §2.6 specifies.** Inbox is *results needing
 * review*, not "everything completed": an order still in the lab is nobody's
 * outstanding work. All results is the unfiltered P1 table the page used to
 * be. Both read the same array and the same filters, so the tab counts, the
 * critical chip and the rows below them cannot disagree — the counts come
 * from one `summarizeLabTests` call, not from three separate tallies.
 *
 * **The Inbox sorts itself** (`sortInbox`): critical first, then anything
 * else abnormal, then longest-waiting inside each band. A doctor's explicit
 * column sort still wins — the ordering is a default, not a cage.
 */
function labsDataset(rows: readonly LabTest[]): ExportDataset {
  return {
    filename: 'medora-labs',
    title: 'Laboratory tests',
    columns: [
      'ID',
      'Patient',
      'Test',
      'Code',
      'Category',
      'Department',
      'Status',
      'Priority',
      'Requested',
      'Review',
      'Reviewed by',
    ],
    rows: rows.map((t) => [
      t.id,
      t.patient.name,
      t.testName,
      t.testCode,
      t.category,
      t.department,
      t.status,
      t.priority,
      formatDate(t.requestedDate),
      LAB_REVIEW_META[reviewState(t)].label,
      t.review?.reviewedBy ?? '',
    ]),
  };
}

export function LabsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMd = useMediaQuery('(min-width: 768px)');
  const filtersDrawer = useDisclosure();

  const list = useLabListState();
  const { data, isPending, isError, isFetching, refetch } = useLabTestsQuery();
  const actions = useLabReviewActions();

  const [searchInput, setSearchInput] = useState(list.q);
  useEffect(() => setSearchInput(list.q), [list.q]);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const tests = useMemo(() => data ?? [], [data]);
  const doctors = useMemo(
    () => [...new Set(tests.map((test) => test.orderedBy))].sort((a, b) => a.localeCompare(b)),
    [tests],
  );
  const summary = useMemo(() => summarizeLabTests(tests), [tests]);

  /* The tab narrows first; every filter then applies within it. */
  const scoped = useMemo(
    () => (list.tab === 'inbox' ? inboxTests(tests) : tests),
    [tests, list.tab],
  );
  const filtered = useMemo(
    () => filterLabTests(scoped, list.q, list.filters),
    [scoped, list.q, list.filters],
  );
  const sorted = useMemo(
    () =>
      list.sort === null && list.tab === 'inbox'
        ? sortInbox(filtered)
        : sortLabTests(filtered, list.sort),
    [filtered, list.sort, list.tab],
  );
  const pageRows = useMemo(
    () => pageSlice(sorted, list.page, list.pageSize),
    [sorted, list.page, list.pageSize],
  );

  const openTest = useCallback(
    (test: LabTest) => navigate(routes.doctor.labReport(test.id)),
    [navigate],
  );

  const {
    openReview,
    openAttach,
    openAnnotate,
    openTrend,
    canReview,
    canAttach,
    canTrend,
    criticalCount,
  } = actions;

  const rowReview = useCallback(
    (test: LabTest) => ({
      canReview: canReview(test),
      canAttach: canAttach(test),
      canTrend: canTrend(test),
      isCritical: criticalCount(test) > 0,
      onMarkReviewed: () => openReview(test),
      onAttach: () => openAttach(test),
      onViewTrend: () => openTrend(test, null),
      onAnnotate: labService.capabilities.annotations ? () => openAnnotate(test) : null,
    }),
    [
      canReview,
      canAttach,
      canTrend,
      criticalCount,
      openReview,
      openAttach,
      openAnnotate,
      openTrend,
    ],
  );

  const columns = useMemo(
    () => buildLabColumns({ onOpenTest: openTest, rowReview }),
    [openTest, rowReview],
  );

  const activeChips = toActiveFilterChips(
    list.filters,
    (patientId) => tests.find((test) => test.patient.id === patientId)?.patient.name,
  );
  const hasSearchOrFilters = list.q !== '' || list.hasActiveFilters;

  /* The selection is scoped to what is on screen; a tab change clears it so
     no action can reach a row the doctor can no longer see. */
  const selectedTests = useMemo(
    () => sorted.filter((test) => selectedIds.includes(test.id)),
    [sorted, selectedIds],
  );
  useEffect(() => setSelectedIds([]), [list.tab]);

  const showingCriticalUnreviewed =
    list.filters.flag === 'critical' && list.filters.review === 'unreviewed';

  const emptyState = hasSearchOrFilters ? (
    <EmptyState
      icon={SearchX}
      title="No tests match"
      description="Nothing matches the current search and filters."
      action={
        <Button
          variant="secondary"
          onClick={() => {
            setSearchInput('');
            list.setQuery('');
            list.clearFilters();
          }}
        >
          Clear search &amp; filters
        </Button>
      }
    />
  ) : list.tab === 'inbox' ? (
    /* UX §2.6: "Empty Inbox: cleared-flavor empty state." */
    <EmptyState
      icon={CheckCheck}
      tone="success"
      title="All results reviewed"
      description="Nothing is waiting on you. New results appear here as the lab releases them."
      action={
        <Button variant="secondary" onClick={() => list.setTab('all')}>
          View all results
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={FlaskConical}
      tone="info"
      title="No laboratory tests yet"
      description="Tests appear here as orders are placed and results are released."
    />
  );

  const tableError = isError
    ? { title: "Couldn't load laboratory tests", onRetry: () => void refetch() }
    : undefined;

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Laboratory"
          caption="Review results, track orders, and trend any analyte over time."
          icon={FlaskConical}
          tone="info"
          breadcrumb={
            <Breadcrumb
              items={[{ label: 'Overview', href: routes.doctor.overview }, { label: 'Labs' }]}
            />
          }
          actions={
            <ExportButton
              getDataset={() => labsDataset(sorted)}
              onExported={(format) =>
                toast({ variant: 'success', title: `Labs exported (${format.toUpperCase()})` })
              }
            />
          }
        />

        {/* D-12 — pinned above the tabs so no filter or tab can hide it. */}
        <CriticalUnreviewedAlert
          count={summary.criticalUnreviewed}
          showing={showingCriticalUnreviewed}
          onShow={list.showCriticalUnreviewed}
        />

        <LabSummaryCards summary={summary} loading={isPending} />

        <Stack gap={4}>
          <Tabs
            aria-label="Laboratory views"
            value={list.tab}
            onValueChange={(value) => list.setTab(value === 'inbox' ? 'inbox' : 'all')}
            items={[
              { value: 'inbox', label: 'Inbox', count: summary.awaitingReview },
              { value: 'all', label: 'All results', count: summary.total },
            ]}
          />

          <FilterBar
            filters={activeChips}
            onRemove={list.removeFilter}
            onClearAll={list.clearFilters}
            search={
              <SearchBar
                label="Search laboratory tests"
                placeholder="Search patient, MRN, lab ID, test name, doctor…"
                value={searchInput}
                onValueChange={setSearchInput}
                onDebouncedChange={list.setQuery}
                resultCount={isPending ? null : filtered.length}
              />
            }
            actions={
              <>
                <Tooltip content="Refresh">
                  <IconButton
                    icon={RefreshCw}
                    aria-label="Refresh laboratory tests"
                    loading={isFetching && !isPending}
                    onClick={() => void refetch()}
                  />
                </Tooltip>
                <Button
                  variant="secondary"
                  leadingIcon={SlidersHorizontal}
                  onClick={filtersDrawer.open}
                  aria-expanded={filtersDrawer.isOpen}
                >
                  Filters{activeChips.length > 0 ? ` (${String(activeChips.length)})` : ''}
                </Button>
              </>
            }
          />

          {selectedIds.length > 0 ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-primary-subtle px-4 py-2"
            >
              <p className="text-body-sm font-medium text-primary">
                {selectedIds.length} test{selectedIds.length === 1 ? '' : 's'} selected
              </p>
              <div className="flex items-center gap-2">
                {/*
                 * Bulk review is offered whenever anything is selected, and
                 * the dialog behind it is where the "normal only" rule is
                 * applied and, more importantly, *shown*. Hiding the button
                 * when the selection contains an abnormal result would leave
                 * a doctor guessing why it vanished.
                 */}
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={CheckCheck}
                  onClick={() => actions.openBulkReview(selectedTests)}
                >
                  Mark reviewed
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Download}
                  onClick={() => {
                    runExport('csv', {
                      ...labsDataset(selectedTests),
                      filename: 'medora-labs-selected',
                    });
                    toast({
                      variant: 'success',
                      title: `Exported ${String(selectedTests.length)} tests`,
                    });
                  }}
                >
                  Export selected
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                  Clear selection
                </Button>
              </div>
            </div>
          ) : null}

          {isMd ? (
            <DataTable
              caption="Laboratory tests with flag, patient, test, order, status, and review details"
              columns={columns}
              rows={pageRows}
              getRowId={(test) => test.id}
              // UX §2.6: critical rows tint error-subtle until they are read.
              getRowClassName={labRowClassName}
              sort={list.sort ?? undefined}
              onSortChange={list.setSort}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onRowClick={openTest}
              loading={isPending}
              loadingRowCount={8}
              error={tableError}
              emptyState={emptyState}
              stickyHeader
            />
          ) : (
            <LabCardList
              tests={pageRows}
              onOpenTest={openTest}
              rowReview={rowReview}
              loading={isPending}
              error={tableError}
              emptyState={emptyState}
            />
          )}

          {!isPending && !isError && sorted.length > 0 ? (
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              totalItems={sorted.length}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          ) : null}
        </Stack>
      </PageSections>

      <LabFiltersDrawer
        doctors={doctors}
        open={filtersDrawer.isOpen}
        onClose={filtersDrawer.close}
        filters={list.filters}
        onFilterChange={list.setFilter}
        onClear={list.clearFilters}
      />

      <MarkReviewedDialog
        open={actions.reviewing !== null}
        test={actions.reviewing}
        reviewer={actions.reviewer}
        onClose={actions.closeReview}
        onConfirm={actions.confirmReview}
        submitting={actions.reviewSubmitting}
        errorMessage={actions.reviewError}
      />

      <BulkReviewDialog
        open={actions.bulkReviewing !== null}
        tests={actions.bulkReviewing ?? []}
        reviewer={actions.reviewer}
        onClose={actions.closeBulkReview}
        onConfirm={actions.confirmBulkReview}
        submitting={actions.bulkSubmitting}
        errorMessage={actions.bulkError}
      />

      <AnnotateResultDialog
        open={actions.annotating !== null}
        test={actions.annotating}
        author={actions.reviewer}
        onClose={actions.closeAnnotate}
        onConfirm={actions.confirmAnnotate}
        submitting={actions.annotateSubmitting}
        errorMessage={actions.annotateError}
      />

      <AttachToRecordDialog
        open={actions.attaching !== null}
        test={actions.attaching}
        attachedBy={actions.reviewer}
        existing={actions.existingAttachments}
        onClose={actions.closeAttach}
        onConfirm={actions.confirmAttach}
        submitting={actions.attachSubmitting}
        errorMessage={actions.attachError}
      />

      {actions.trending !== null ? (
        <AnalyteTrendDrawer
          open
          onClose={actions.closeTrend}
          tests={tests}
          patientId={actions.trending.test.patient.id}
          patientName={actions.trending.test.patient.name}
          initialAnalyte={actions.trending.analyte}
        />
      ) : null}
    </PageContainer>
  );
}
