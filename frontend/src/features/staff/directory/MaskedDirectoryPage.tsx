import { useState } from 'react';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';

import { Alert, EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections } from '@/components/layout';
import { DataTable, Input, Pagination, type DataTableColumn } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

import {
  DIRECTORY_PAGE_SIZE,
  maskedDirectoryService,
  staffDirectoryKeys,
  type MaskedPatient,
} from './masked-directory';

/**
 * The patient directory for Reception, Laboratory and Pharmacy (DEC-006a).
 *
 * Masked by the server, read-only, and without a reveal: the staff roles hold
 * `patients.view` (the masked projection) and not `patients.revealIdentity`.
 * It answers "is this patient registered, and under which Medora id", which
 * is what a front desk or a laboratory needs to match a request to a record —
 * not who the patient is. Opening a chart is not offered: charts are reached
 * through a care relationship, which no staff role has.
 */

const show = (value: string | null) => value ?? '—';

const COLUMNS: ReadonlyArray<DataTableColumn<MaskedPatient>> = [
  {
    id: 'patientId',
    header: 'Patient ID',
    cell: (row) => (
      <span className="font-mono" dir="ltr">
        {row.patientId}
      </span>
    ),
  },
  { id: 'name', header: 'Name', cell: (row) => row.name },
  {
    id: 'mrn',
    header: 'MRN',
    cell: (row) => (
      <span className="font-mono" dir="ltr">
        {row.mrn}
      </span>
    ),
  },
  {
    id: 'dateOfBirth',
    header: 'Date of birth',
    cell: (row) => (
      <span className="tabular-nums" dir="ltr">
        {show(row.dateOfBirth)}
      </span>
    ),
  },
  {
    id: 'phone',
    header: 'Phone',
    cell: (row) => (
      <span className="font-mono" dir="ltr">
        {show(row.phone)}
      </span>
    ),
  },
];

export function MaskedDirectoryPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim(), 300);

  const query = useQuery({
    queryKey: [...staffDirectoryKeys.lists(), { q, page }] as const,
    queryFn: () => maskedDirectoryService.list({ q, page }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const rows = query.data?.items ?? [];

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Patient directory"
          caption="Registered patients, with identifiers masked."
          icon={Users}
        />

        <Alert variant="info" title="Identifiers are masked">
          Names, record numbers and contact details are masked by the server for your role, and
          cannot be revealed here. Use the Patient ID to refer to a patient.
        </Alert>

        <Input
          type="search"
          label="Search patients"
          leadingIcon={Search}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Name, Patient ID or MRN"
          containerClassName="max-w-md"
        />

        <DataTable
          caption="Registered patients with masked identifiers"
          columns={COLUMNS}
          rows={rows}
          getRowId={(row) => row.patientId}
          loading={query.isPending}
          error={
            query.isError
              ? { title: "Couldn't load the patient directory", onRetry: () => void query.refetch() }
              : undefined
          }
          emptyState={
            <EmptyState
              title={q === '' ? 'No patients registered' : 'No patients match this search'}
              description={
                q === ''
                  ? 'Registered patients will appear here.'
                  : 'Try a Patient ID or a different spelling.'
              }
            />
          }
        />

        {query.data !== undefined && query.data.totalItems > DIRECTORY_PAGE_SIZE ? (
          <Pagination
            page={query.data.page}
            pageSize={DIRECTORY_PAGE_SIZE}
            totalItems={query.data.totalItems}
            onPageChange={setPage}
            disabled={query.isFetching}
          />
        ) : null}
      </PageSections>
    </PageContainer>
  );
}
