import { useEffect, useMemo, useState } from 'react';

import {
  CalendarPlus,
  Download,
  EllipsisVertical,
  RefreshCw,
  SearchX,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useToast } from '@/app/providers';
import { EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { ExportButton, FilterBar, SearchBar } from '@/components/patterns';
import {
  Breadcrumb,
  Button,
  DataTable,
  Dropdown,
  IconButton,
  Pagination,
  Tooltip,
} from '@/components/ui';
import { DEFAULT_PAGE_SIZE } from '@/constants';
import type { Patient } from '@/features/shared-domain/patient-identity';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { routes } from '@/routes';
import { runExport, type ExportDataset } from '@/utils/export';
import { pageSlice } from '@/utils/pagination';

import { usePatientsQuery } from '../api/usePatientsQuery';
import { PATIENT_COLUMNS } from '../components/patient-table-columns';
import { PatientCardList } from '../components/PatientCardList';
import { PatientFiltersDrawer } from '../components/PatientFiltersDrawer';
import { PatientsSummaryCards } from '../components/PatientsSummaryCards';
import { usePatientListState } from '../hooks/usePatientListState';
import { toActiveFilterChips } from '../model/filters';
import { filterPatients, sortPatients, summarizePatients } from '../model/selectors';

/**
 * Patients page — UX 2.2 (P1 data-table page).
 * URL search params own every piece of view state (search, filters, sort,
 * pagination); the mock patients query supplies the roster. Desktop
 * renders the DataTable; below `md` the same list renders as stacked
 * cards with identical capabilities (UX §5.2).
 */

const EMPTY_SUMMARY = { total: 0, active: 0, highRisk: 0, todaysVisits: 0, newThisMonth: 0 };

function SelectionBar({
  count,
  onExport,
  onClear,
}: {
  count: number;
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-primary-subtle px-4 py-2"
    >
      <p className="text-body-sm font-medium text-primary">
        {count} patient{count === 1 ? '' : 's'} selected
      </p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" leadingIcon={Download} onClick={onExport}>
          Export selected
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear selection
        </Button>
      </div>
    </div>
  );
}

function patientsDataset(rows: readonly Patient[]): ExportDataset {
  return {
    filename: 'medora-patients',
    title: 'Patients',
    columns: [
      'Name',
      'MRN',
      'Date of birth',
      'Age',
      'Gender',
      'Blood type',
      'Phone',
      'Status',
      'Risk',
      'Doctor',
    ],
    rows: rows.map((p) => [
      p.name,
      p.mrn,
      p.dateOfBirth.slice(0, 10),
      p.age,
      p.gender,
      p.bloodType,
      p.phone,
      p.status,
      p.riskLevel,
      p.assignedDoctor,
    ]),
  };
}

export function PatientsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMd = useMediaQuery('(min-width: 768px)');
  const filtersDrawer = useDisclosure();

  const list = usePatientListState();
  // The summary cards describe the whole caseload, so they read the
  // unfiltered list. A condition filter is applied by the service (the
  // list projection carries no conditions to filter on here), so the table
  // reads a second, condition-scoped query while one is set.
  const caseload = usePatientsQuery();
  const condition = list.filters.condition;
  const byCondition = usePatientsQuery({ condition, enabled: condition !== null });
  const { data, isPending, isError, isFetching, refetch } =
    condition === null ? caseload : byCondition;

  // The input mirrors the URL `q`; the debounced commit writes it back.
  const [searchInput, setSearchInput] = useState(list.q);
  useEffect(() => setSearchInput(list.q), [list.q]);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const patients = useMemo(() => data ?? [], [data]);
  const summary = useMemo(
    () => (caseload.data ? summarizePatients(caseload.data) : EMPTY_SUMMARY),
    [caseload.data],
  );
  const filtered = useMemo(
    () => filterPatients(patients, list.q, list.filters),
    [patients, list.q, list.filters],
  );
  const sorted = useMemo(() => sortPatients(filtered, list.sort), [filtered, list.sort]);
  const pageRows = useMemo(
    () => pageSlice(sorted, list.page, list.pageSize),
    [sorted, list.page, list.pageSize],
  );

  const activeChips = toActiveFilterChips(list.filters);
  const hasSearchOrFilters = list.q !== '' || list.hasActiveFilters;

  const clearSearchAndFilters = () => {
    setSearchInput('');
    list.setQuery('');
    list.clearFilters();
  };

  const emptyState = hasSearchOrFilters ? (
    <EmptyState
      icon={SearchX}
      title="No patients match"
      description={
        list.q !== ''
          ? `Nothing matches "${list.q}" with the current filters.`
          : 'Nothing matches the current filters.'
      }
      action={
        <Button variant="secondary" onClick={clearSearchAndFilters}>
          Clear search & filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={Users}
      tone="primary"
      title="No patients yet"
      description="Patients are assigned to you when they book their first appointment."
    />
  );

  const tableError = isError
    ? { title: "Couldn't load your patients", onRetry: () => void refetch() }
    : undefined;

  const toggleSelect = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Patients"
          caption="Every patient under your care — search, filter, and act."
          icon={Users}
          tone="primary"
          breadcrumb={
            <Breadcrumb
              items={[{ label: 'Overview', href: routes.doctor.overview }, { label: 'Patients' }]}
            />
          }
          actions={
            <>
              <Button
                variant="secondary"
                leadingIcon={CalendarPlus}
                // Opens the booking dialog, not just the book (Q-03).
                onClick={() => navigate(routes.doctor.bookAppointment())}
              >
                New appointment
              </Button>
              <Button leadingIcon={UserPlus} onClick={() => navigate(routes.doctor.newPatient)}>
                Add patient
              </Button>
              <Dropdown
                align="end"
                menuLabel="More patient actions"
                entries={[
                  {
                    id: 'export',
                    label: 'Export patients (CSV)',
                    icon: Download,
                    onSelect: () => {
                      runExport('csv', patientsDataset(sorted));
                      toast({ variant: 'success', title: 'Patients exported (CSV)' });
                    },
                  },
                ]}
                trigger={<IconButton icon={EllipsisVertical} aria-label="More patient actions" />}
              />
            </>
          }
        />

        <PatientsSummaryCards summary={summary} loading={caseload.isPending} />

        <Stack gap={4}>
          <FilterBar
            filters={activeChips}
            onRemove={list.removeFilter}
            onClearAll={list.clearFilters}
            search={
              <SearchBar
                label="Search patients"
                placeholder="Search name, MRN, patient ID, phone…"
                value={searchInput}
                onValueChange={setSearchInput}
                onDebouncedChange={list.setQuery}
                resultCount={isPending ? null : filtered.length}
              />
            }
            actions={
              <>
                <Tooltip content="Refresh list">
                  <IconButton
                    icon={RefreshCw}
                    aria-label="Refresh patient list"
                    loading={isFetching && !isPending}
                    onClick={() => void refetch()}
                  />
                </Tooltip>
                <ExportButton
                  getDataset={() => patientsDataset(sorted)}
                  onExported={(format) =>
                    toast({
                      variant: 'success',
                      title: `Patients exported (${format.toUpperCase()})`,
                    })
                  }
                />
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
            <SelectionBar
              count={selectedIds.length}
              onExport={() => {
                const selected = sorted.filter((p) => selectedIds.includes(p.id));
                runExport('csv', {
                  ...patientsDataset(selected),
                  filename: 'medora-patients-selected',
                });
                toast({
                  variant: 'success',
                  title: `Exported ${String(selected.length)} patients`,
                });
              }}
              onClear={() => setSelectedIds([])}
            />
          ) : null}

          {isMd ? (
            <DataTable
              caption="Patients under your care, with contact, visit, and risk details"
              columns={PATIENT_COLUMNS}
              rows={pageRows}
              getRowId={(patient) => patient.id}
              sort={list.sort ?? undefined}
              onSortChange={list.setSort}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onRowClick={(patient) => navigate(routes.doctor.patient(patient.id))}
              loading={isPending}
              loadingRowCount={DEFAULT_PAGE_SIZE}
              error={tableError}
              emptyState={emptyState}
              stickyHeader
            />
          ) : (
            <PatientCardList
              patients={pageRows}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
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

      <PatientFiltersDrawer
        open={filtersDrawer.isOpen}
        onClose={filtersDrawer.close}
        filters={list.filters}
        onFilterChange={list.setFilter}
        onClear={list.clearFilters}
      />
    </PageContainer>
  );
}
