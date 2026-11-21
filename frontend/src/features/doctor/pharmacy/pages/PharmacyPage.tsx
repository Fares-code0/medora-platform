import { useCallback, useEffect, useMemo, useState } from 'react';

import { Download, FilePlus2, Pill, RefreshCw, SearchX, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useCan, useToast } from '@/app/providers';
import { EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { ExportButton, FilterBar, SearchBar } from '@/components/patterns';
import { Breadcrumb, Button, DataTable, IconButton, Pagination, Tooltip } from '@/components/ui';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatDate } from '@/i18n';
import { routes } from '@/routes';
import { runExport, type ExportDataset } from '@/utils/export';
import { pageSlice } from '@/utils/pagination';

import { usePrescriptionsQuery } from '../api/usePrescriptionsQuery';
import { DiscardPrescriptionDraftDialog } from '../components/DiscardPrescriptionDraftDialog';
import { EndPrescriptionDialog } from '../components/EndPrescriptionDialog';
import { PharmacyFiltersDrawer } from '../components/PharmacyFiltersDrawer';
import { PharmacySummaryCards } from '../components/PharmacySummaryCards';
import { buildPrescriptionColumns } from '../components/prescription-table-columns';
import { PrescriptionCardList } from '../components/PrescriptionCardList';
import { usePharmacyListState } from '../hooks/usePharmacyListState';
import { usePrescriptionLifecycle } from '../hooks/usePrescriptionLifecycle';
import { toActiveFilterChips } from '../model/filters';
import { filterPrescriptions, sortPrescriptions, summarizePrescriptions } from '../model/selectors';
import { type PrescriptionSummary } from '../model/types';

/**
 * Pharmacy list — the P1 enterprise prescription-management surface:
 * URL-owned search/filters/sort/pagination over the prescription dataset,
 * summary cards, active filter chips, and a sticky-header DataTable
 * (stacked cards under md). Rows open the full prescription detail page.
 */
function pharmacyDataset(rows: readonly PrescriptionSummary[]): ExportDataset {
  return {
    filename: 'medora-prescriptions',
    title: 'Prescriptions',
    columns: ['ID', 'Patient', 'Medication', 'Dosage', 'Frequency', 'Status', 'Doctor', 'Start', 'End'],
    rows: rows.map((p) => [
      p.id,
      p.patient.name,
      p.medication.name,
      p.dosage,
      p.frequency,
      p.status,
      p.prescribingDoctor,
      formatDate(p.startDate),
      formatDate(p.endDate),
    ]),
  };
}

export function PharmacyPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  // The same capability the authoring route and the sidebar entry require.
  const canPrescribe = useCan()('prescriptions.create');
  const isMd = useMediaQuery('(min-width: 768px)');
  const filtersDrawer = useDisclosure();

  const lifecycle = usePrescriptionLifecycle();
  const list = usePharmacyListState();
  const { data, isPending, isError, isFetching, refetch } = usePrescriptionsQuery();

  const [searchInput, setSearchInput] = useState(list.q);
  useEffect(() => setSearchInput(list.q), [list.q]);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const prescriptions = useMemo(() => data ?? [], [data]);
  const doctors = useMemo(
    () => [...new Set(prescriptions.map((row) => row.prescribingDoctor))].sort((a, b) => a.localeCompare(b)),
    [prescriptions],
  );
  const summary = useMemo(() => summarizePrescriptions(prescriptions), [prescriptions]);
  const filtered = useMemo(
    () => filterPrescriptions(prescriptions, list.q, list.filters),
    [prescriptions, list.q, list.filters],
  );
  const sorted = useMemo(() => sortPrescriptions(filtered, list.sort), [filtered, list.sort]);
  const pageRows = useMemo(
    () => pageSlice(sorted, list.page, list.pageSize),
    [sorted, list.page, list.pageSize],
  );

  const openPrescription = useCallback(
    (prescription: PrescriptionSummary) => navigate(routes.doctor.prescription(prescription.id)),
    [navigate],
  );

  const columns = useMemo(
    () =>
      buildPrescriptionColumns({
        onOpen: openPrescription,
        onRenew: lifecycle.onRenew,
        onEnd: lifecycle.openEnd,
      }),
    [openPrescription, lifecycle.onRenew, lifecycle.openEnd],
  );

  const activeChips = toActiveFilterChips(
    list.filters,
    (patientId) =>
      prescriptions.find((prescription) => prescription.patient.id === patientId)?.patient.name,
  );
  const hasSearchOrFilters = list.q !== '' || list.hasActiveFilters;

  const emptyState = hasSearchOrFilters ? (
    <EmptyState
      icon={SearchX}
      title="No prescriptions match"
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
      icon={Pill}
      tone="success"
      title="No prescriptions yet"
      description="Prescriptions appear here as they are issued to patients."
    />
  );

  const tableError = isError
    ? { title: "Couldn't load prescriptions", onRetry: () => void refetch() }
    : undefined;

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Pharmacy"
          caption="Search, review, and manage patient prescriptions and medications."
          icon={Pill}
          tone="success"
          breadcrumb={
            <Breadcrumb
              items={[{ label: 'Overview', href: routes.doctor.overview }, { label: 'Pharmacy' }]}
            />
          }
          actions={
            <>
              {canPrescribe ? (
                <Button
                  leadingIcon={FilePlus2}
                  onClick={() => navigate(routes.doctor.newPrescription())}
                >
                  New prescription
                </Button>
              ) : null}
              <ExportButton
                getDataset={() => pharmacyDataset(sorted)}
                onExported={(format) =>
                  toast({
                    variant: 'success',
                    title: `Prescriptions exported (${format.toUpperCase()})`,
                  })
                }
              />
            </>
          }
        />

        <PharmacySummaryCards summary={summary} loading={isPending} />

        <Stack gap={4}>
          <FilterBar
            filters={activeChips}
            onRemove={list.removeFilter}
            onClearAll={list.clearFilters}
            search={
              <SearchBar
                label="Search prescriptions"
                placeholder="Search patient, MRN, Rx ID, medication, doctor…"
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
                    aria-label="Refresh prescriptions"
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
                {selectedIds.length} prescription{selectedIds.length === 1 ? '' : 's'} selected
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Download}
                  onClick={() => {
                    const selected = sorted.filter((p) => selectedIds.includes(p.id));
                    runExport('csv', {
                      ...pharmacyDataset(selected),
                      filename: 'medora-prescriptions-selected',
                    });
                    toast({ variant: 'success', title: `Exported ${String(selected.length)} prescriptions` });
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
              caption="Prescriptions with patient, medication, dosage, schedule, prescriber, and status"
              columns={columns}
              rows={pageRows}
              getRowId={(prescription) => prescription.id}
              sort={list.sort ?? undefined}
              onSortChange={list.setSort}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onRowClick={openPrescription}
              loading={isPending}
              loadingRowCount={8}
              error={tableError}
              emptyState={emptyState}
              stickyHeader
            />
          ) : (
            <PrescriptionCardList
              prescriptions={pageRows}
              onOpen={openPrescription}
              onRenew={lifecycle.onRenew}
              onEnd={lifecycle.openEnd}
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

      {lifecycle.ending === null ? null : (
        <EndPrescriptionDialog
          open
          act={lifecycle.ending.act}
          prescriptionId={lifecycle.ending.prescription.id}
          medicationLabel={`${lifecycle.ending.prescription.medication.name} ${lifecycle.ending.prescription.dosage}`}
          loading={lifecycle.endPending}
          onConfirm={lifecycle.onConfirmEnd}
          onClose={lifecycle.closeEnd}
        />
      )}

      {lifecycle.discarding === null ? null : (
        <DiscardPrescriptionDraftDialog
          prescriptionId={lifecycle.discarding.id}
          medicationLabel={`${lifecycle.discarding.medication.name} ${lifecycle.discarding.dosage}`}
          loading={lifecycle.discardPending}
          onConfirm={lifecycle.onConfirmDiscard}
          onClose={lifecycle.closeDiscard}
        />
      )}

      <PharmacyFiltersDrawer
        doctors={doctors}
        open={filtersDrawer.isOpen}
        onClose={filtersDrawer.close}
        filters={list.filters}
        onFilterChange={list.setFilter}
        onBooleanChange={list.setBoolean}
        onClear={list.clearFilters}
      />
    </PageContainer>
  );
}
