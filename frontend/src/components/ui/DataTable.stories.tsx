import { useMemo, useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { EmptyState } from '../feedback/EmptyState';
import { StatusBadge } from '../patterns/StatusBadge';

import { DataTable, type DataTableColumn, type SortState } from './DataTable';

/**
 * DS §8.21. Sort, selection, density, zebra, the loading / error / empty
 * states, and the sticky first column (DEC-015) — pinned only when the table
 * overflows, opaque in both themes, carrying the row's own tint. The
 * "Overflowing" story is narrow on purpose: scroll it sideways.
 */
interface Row {
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly age: number;
  readonly ward: string;
  readonly status: 'active' | 'archived';
  readonly critical: boolean;
}

const ROWS: readonly Row[] = [
  {
    id: '1',
    name: 'Khaled Mansour',
    mrn: 'MRN-10042',
    age: 54,
    ward: '3B',
    status: 'active',
    critical: true,
  },
  {
    id: '2',
    name: 'Layla Haddad',
    mrn: 'MRN-10057',
    age: 31,
    ward: '2A',
    status: 'active',
    critical: false,
  },
  {
    id: '3',
    name: 'Omar Saleh',
    mrn: 'MRN-10063',
    age: 67,
    ward: '3B',
    status: 'archived',
    critical: false,
  },
  {
    id: '4',
    name: 'Nour Al-Amin',
    mrn: 'MRN-10071',
    age: 45,
    ward: '1C',
    status: 'active',
    critical: false,
  },
  {
    id: '5',
    name: 'Yusuf Karimi',
    mrn: 'MRN-10088',
    age: 72,
    ward: '2A',
    status: 'active',
    critical: true,
  },
];

const COLUMNS: ReadonlyArray<DataTableColumn<Row>> = [
  { id: 'name', header: 'Patient', cell: (row) => row.name, sortable: true, rowHeader: true },
  { id: 'mrn', header: 'MRN', cell: (row) => row.mrn, mono: true },
  { id: 'age', header: 'Age', cell: (row) => row.age, sortable: true, numeric: true },
  { id: 'ward', header: 'Ward', cell: (row) => row.ward, hideBelowMd: true },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <StatusBadge status={row.status} label={row.status === 'active' ? 'Active' : 'Archived'} />
    ),
  },
];

function Interactive(props: {
  selectable?: boolean;
  zebra?: boolean;
  dense?: boolean;
  tint?: boolean;
}) {
  const [sort, setSort] = useState<SortState>({ columnId: 'name', direction: 'asc' });
  const [selected, setSelected] = useState<readonly string[]>(['2']);
  const rows = useMemo(() => {
    const sorted = [...ROWS].sort((a, b) => {
      const key = sort.columnId as 'name' | 'age';
      const order = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      return sort.direction === 'asc' ? order : -order;
    });
    return sorted;
  }, [sort]);
  return (
    <DataTable
      caption="Patients on your list"
      columns={COLUMNS}
      rows={rows}
      getRowId={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      selectable={props.selectable ?? false}
      selectedIds={selected}
      onSelectionChange={setSelected}
      zebra={props.zebra ?? false}
      dense={props.dense ?? false}
      getRowClassName={
        props.tint === true
          ? (row) =>
              row.critical ? 'bg-error-subtle [--row-bg:var(--color-error-subtle)]' : undefined
          : undefined
      }
    />
  );
}

const meta = {
  title: 'UI/DataTable',
  component: DataTable<Row>,
  args: {
    caption: 'Patients on your list',
    columns: COLUMNS,
    rows: ROWS,
    getRowId: (row) => row.id,
  },
} satisfies Meta<typeof DataTable<Row>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sortable: Story = { render: () => <Interactive /> };

export const Selectable: Story = { render: () => <Interactive selectable /> };

export const ZebraDense: Story = { render: () => <Interactive zebra dense /> };

export const RowTint: Story = { render: () => <Interactive selectable tint /> };

export const Overflowing: Story = {
  render: () => (
    <div className="max-w-sm">
      <Interactive selectable tint zebra />
    </div>
  ),
};

export const Loading: Story = { args: { loading: true } };

export const ErrorState: Story = { args: { rows: [], error: { onRetry: () => {} } } };

export const Empty: Story = {
  args: {
    rows: [],
    emptyState: <EmptyState title="No patients match" description="Try clearing a filter." />,
  },
};
