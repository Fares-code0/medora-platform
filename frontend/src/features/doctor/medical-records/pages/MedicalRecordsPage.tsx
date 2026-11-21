import { useCallback, useEffect, useMemo, useState } from 'react';

import { Download, FilePlus2, FolderHeart, RefreshCw, SearchX, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useToast } from '@/app/providers';
import { EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { ExportButton, FilterBar, SearchBar } from '@/components/patterns';
import { Breadcrumb, Button, DataTable, IconButton, Pagination, Tooltip } from '@/components/ui';
import { DEFAULT_PAGE_SIZE } from '@/constants';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatDate } from '@/i18n';
import { routes } from '@/routes';
import { runExport, type ExportDataset } from '@/utils/export';
import { pageSlice } from '@/utils/pagination';

import { useMedicalRecordsQuery } from '../api/useMedicalRecordsQuery';
import { buildMedicalRecordColumns } from '../components/medical-record-table-columns';
import { MedicalRecordCardList } from '../components/MedicalRecordCardList';
import { MedicalRecordFiltersDrawer } from '../components/MedicalRecordFiltersDrawer';
import { MedicalRecordsSummaryCards } from '../components/MedicalRecordsSummaryCards';
import { useMedicalRecordListState } from '../hooks/useMedicalRecordListState';
import { toActiveFilterChips } from '../model/filters';
import { filterRecords, sortRecords, summarizeRecords } from '../model/selectors';
import { type MedicalRecordSummary } from '../model/types';

/**
 * Medical records list — the P1 enterprise records-management surface:
 * URL-owned search/filters/sort/pagination over the records dataset,
 * summary cards, active filter chips, and a sticky-header DataTable
 * (stacked cards under md). Rows open the full record detail page.
 */
function recordsDataset(rows: readonly MedicalRecordSummary[]): ExportDataset {
  return {
    filename: 'medora-records',
    title: 'Medical records',
    columns: ['ID', 'Patient', 'Visit date', 'Visit type', 'Department', 'Doctor', 'Status', 'Priority'],
    rows: rows.map((r) => [
      r.id,
      r.patient.name,
      formatDate(r.visitDate),
      r.visitType,
      r.department,
      r.doctor,
      r.status,
      r.priority,
    ]),
  };
}

export function MedicalRecordsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMd = useMediaQuery('(min-width: 768px)');
  const filtersDrawer = useDisclosure();

  const list = useMedicalRecordListState();
  const { data, isPending, isError, isFetching, refetch } = useMedicalRecordsQuery();

  const [searchInput, setSearchInput] = useState(list.q);
  useEffect(() => setSearchInput(list.q), [list.q]);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const records = useMemo(() => data ?? [], [data]);
  const doctors = useMemo(
    () => [...new Set(records.map((row) => row.doctor))].sort((a, b) => a.localeCompare(b)),
    [records],
  );
  const summary = useMemo(() => summarizeRecords(records), [records]);
  const filtered = useMemo(
    () => filterRecords(records, list.q, list.filters),
    [records, list.q, list.filters],
  );
  const sorted = useMemo(() => sortRecords(filtered, list.sort), [filtered, list.sort]);
  const pageRows = useMemo(
    () => pageSlice(sorted, list.page, list.pageSize),
    [sorted, list.page, list.pageSize],
  );

  const openRecord = useCallback(
    (record: MedicalRecordSummary) => navigate(routes.doctor.medicalRecord(record.id)),
    [navigate],
  );

  const columns = useMemo(
    () => buildMedicalRecordColumns({ onOpenRecord: openRecord }),
    [openRecord],
  );

  const activeChips = toActiveFilterChips(
    list.filters,
    (patientId) => records.find((record) => record.patient.id === patientId)?.patient.name,
  );
  const hasSearchOrFilters = list.q !== '' || list.hasActiveFilters;

  const emptyState = hasSearchOrFilters ? (
    <EmptyState
      icon={SearchX}
      title="No records match"
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
          Clear search & filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={FolderHeart}
      tone="secondary"
      title="No medical records yet"
      description="Records appear here as encounters are documented."
    />
  );

  const tableError = isError
    ? { title: "Couldn't load medical records", onRetry: () => void refetch() }
    : undefined;

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Medical Records"
          caption="Search, review, and manage patient encounter records."
          icon={FolderHeart}
          tone="secondary"
          breadcrumb={
            <Breadcrumb
              items={[
                { label: 'Overview', href: routes.doctor.overview },
                { label: 'Medical records' },
              ]}
            />
          }
          actions={
            <>
              {/* D-21's entry point. The module's primary action is now
                  authoring a record, not exporting the list of them. */}
              <Button
                leadingIcon={FilePlus2}
                onClick={() => navigate(routes.doctor.newMedicalRecord())}
              >
                New record
              </Button>
              <ExportButton
                getDataset={() => recordsDataset(sorted)}
                onExported={(format) =>
                  toast({ variant: 'success', title: `Records exported (${format.toUpperCase()})` })
                }
              />
            </>
          }
        />

        {/* Document-registry layout: the records table is the hero; the
            dataset metrics sit in a metadata rail on xl+ (stacked band
            above the table below xl).

            `grid-cols-1` and `min-w-0` keep a wide table inside its own
            scroller. Without an explicit track below xl the grid's one
            implicit column sized itself to the table, and the whole page
            scrolled sideways — cards and pagination cut off with it. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <aside className="xl:order-2">
            <MedicalRecordsSummaryCards summary={summary} loading={isPending} />
          </aside>

          <Stack gap={4} className="min-w-0 xl:order-1 xl:col-span-3">
            <FilterBar
              filters={activeChips}
              onRemove={list.removeFilter}
              onClearAll={list.clearFilters}
              search={
                <SearchBar
                  label="Search medical records"
                  placeholder="Search patient, MRN, record ID, diagnosis, doctor…"
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
                      aria-label="Refresh medical records"
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
                  {selectedIds.length} record{selectedIds.length === 1 ? '' : 's'} selected
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={Download}
                    onClick={() => {
                      const selected = sorted.filter((r) => selectedIds.includes(r.id));
                      runExport('csv', { ...recordsDataset(selected), filename: 'medora-records-selected' });
                      toast({ variant: 'success', title: `Exported ${String(selected.length)} records` });
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
                caption="Medical records with patient, visit, diagnosis, status, and priority details"
                columns={columns}
                rows={pageRows}
                getRowId={(record) => record.id}
                sort={list.sort ?? undefined}
                onSortChange={list.setSort}
                selectable
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onRowClick={openRecord}
                loading={isPending}
                loadingRowCount={DEFAULT_PAGE_SIZE}
                error={tableError}
                emptyState={emptyState}
                stickyHeader
              />
            ) : (
              <MedicalRecordCardList
                records={pageRows}
                onOpenRecord={openRecord}
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
        </div>
      </PageSections>

      <MedicalRecordFiltersDrawer
        doctors={doctors}
        open={filtersDrawer.isOpen}
        onClose={filtersDrawer.close}
        filters={list.filters}
        onFilterChange={list.setFilter}
        onClear={list.clearFilters}
      />
    </PageContainer>
  );
}
