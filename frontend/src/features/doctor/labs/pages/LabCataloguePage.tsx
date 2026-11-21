import { FlaskConical } from 'lucide-react';

import { Alert, EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections } from '@/components/layout';
import { DataTable, type DataTableColumn } from '@/components/ui';
import type { TestSpec } from '@/features/shared-domain/lab-studies';

import { useLabCatalogueQuery } from '../api/useLabTestsQuery';

/**
 * The laboratory's test catalogue, read-only (DEC-006a) — `GET
 * /lab-tests/catalogue`, active entries, through the labs feature's own
 * service, so a laboratory account and the ordering flow read one list.
 *
 * Mounted by the app layer into the laboratory workspace. It offers nothing
 * to act on: what a technician may do with *orders* is not something the
 * server grants yet (BR-DEC-006), and this page says so rather than linking to
 * a worklist that would answer 404.
 */

function referenceOf(test: TestSpec): string {
  const numeric = test.analytes.filter((analyte) => analyte.low !== null || analyte.high !== null);
  return `${String(test.analytes.length)} analyte${test.analytes.length === 1 ? '' : 's'}${
    numeric.length > 0 && numeric.length < test.analytes.length ? ` (${String(numeric.length)} numeric)` : ''
  }`;
}

const COLUMNS: ReadonlyArray<DataTableColumn<TestSpec>> = [
  { id: 'name', header: 'Test', cell: (test) => <span className="font-medium">{test.name}</span> },
  {
    id: 'code',
    header: 'Code',
    cell: (test) => (
      <span className="font-mono" dir="ltr">
        {test.code}
      </span>
    ),
  },
  { id: 'category', header: 'Category', cell: (test) => test.category },
  { id: 'specimen', header: 'Specimen', cell: (test) => test.specimen },
  { id: 'container', header: 'Container', cell: (test) => test.container },
  { id: 'analytes', header: 'Analytes', cell: referenceOf },
];

export function LabCataloguePage() {
  const query = useLabCatalogueQuery();

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Test catalogue"
          caption="The tests the laboratory offers."
          icon={FlaskConical}
        />
        <Alert variant="info" title="Read-only">
          Lab orders, result entry and order progress are not available to laboratory accounts yet.
        </Alert>
        <DataTable
          caption="Laboratory tests with code, category, specimen, container and analytes"
          columns={COLUMNS}
          rows={query.data ?? []}
          getRowId={(test) => test.code}
          loading={query.isPending}
          error={
            query.isError
              ? { title: "Couldn't load the test catalogue", onRetry: () => void query.refetch() }
              : undefined
          }
          emptyState={
            <EmptyState
              title="No tests in the catalogue"
              description="Active laboratory tests will appear here."
            />
          }
        />
      </PageSections>
    </PageContainer>
  );
}
