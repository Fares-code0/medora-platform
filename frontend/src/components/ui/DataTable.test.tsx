import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableColumn } from './DataTable';

/**
 * DataTable contract — DS §8.19, pinned in Wave 2c-a.
 *
 * The platform table had no tests at all before this wave, which is a poor
 * position from which to consolidate a second table engine into it. These
 * assertions are the safety net: the "existing behaviour" block is written
 * against what the component did BEFORE 2c-a touched it, so the additive
 * props cannot quietly move a default underneath the ten doctor-side sites
 * already rendering it.
 */

interface Row {
  readonly id: string;
  readonly name: string;
  readonly dept: string;
  readonly count: number;
}

const ROWS: readonly Row[] = [
  { id: 'r1', name: 'Ada', dept: 'Cardiology', count: 3 },
  { id: 'r2', name: 'Grace', dept: 'Neurology', count: 11 },
  { id: 'r3', name: 'Alan', dept: 'Oncology', count: 7 },
];

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
  { id: 'dept', header: 'Department', cell: (r) => r.dept },
  { id: 'count', header: 'Count', cell: (r) => r.count, numeric: true },
];

type Props = Parameters<typeof DataTable<Row>>[0];

function renderTable(props: Partial<Props> = {}) {
  return render(
    <DataTable columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} caption="Staff" {...props} />,
  );
}

/* ── Existing behaviour — must not move ───────────────────────── */

describe('DataTable · naming and structure', () => {
  it('names the table from its visually hidden caption', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'Staff' });
    expect(table.querySelector('caption')?.className).toContain('sr-only');
  });

  it('renders a header cell per column and a row per row', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual([
      'Name',
      'Department',
      'Count',
    ]);
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1);
  });

  it('keeps its own card container', () => {
    const { container } = renderTable();
    const shell = container.firstElementChild;
    expect(shell?.className).toContain('rounded-surface');
    expect(shell?.className).toContain('border-border');
    expect(shell?.className).toContain('bg-surface');
    expect(shell?.className).toContain('overflow-x-auto');
  });

  it('sticks the header by default', () => {
    const { container } = renderTable();
    expect(container.querySelector('thead')?.className).toContain('sticky');
  });

  it('stripes alternating rows by default', () => {
    renderTable();
    expect(screen.getAllByRole('row')[1]?.className).toContain('even:bg-background');
  });

  it('renders body cells in the primary text role', () => {
    renderTable();
    expect(screen.getByText('Ada').className).toContain('text-text-primary');
  });

  it('applies numeric columns as right-aligned tabular figures', () => {
    renderTable();
    const cell = screen.getByText('11');
    expect(cell.className).toContain('text-end');
    expect(cell.className).toContain('tabular-nums');
  });

  it('applies mono to columns that ask for it', () => {
    renderTable({
      columns: [{ id: 'name', header: 'Name', cell: (r: Row) => r.name, mono: true }],
    });
    expect(screen.getByText('Ada').className).toContain('font-mono');
  });
});

describe('DataTable · sorting', () => {
  it('renders a sort handle only for sortable columns with a handler', () => {
    renderTable({ onSortChange: vi.fn() });
    expect(screen.getByRole('button', { name: /name/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /department/i })).not.toBeInTheDocument();
  });

  it('renders no handle at all without onSortChange', () => {
    renderTable();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('announces the sorted column and direction via aria-sort', () => {
    renderTable({ sort: { columnId: 'name', direction: 'asc' }, onSortChange: vi.fn() });
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getByRole('columnheader', { name: 'Department' })).not.toHaveAttribute(
      'aria-sort',
    );
  });

  it('cycles asc → desc on the active column, and resets to asc on a new one', async () => {
    const onSortChange = vi.fn();
    const { rerender } = renderTable({
      sort: { columnId: 'name', direction: 'asc' },
      onSortChange,
    });
    await userEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: 'name', direction: 'desc' });

    rerender(
      <DataTable
        columns={[
          ...COLUMNS,
          { id: 'dept2', header: 'Dept2', cell: (r) => r.dept, sortable: true },
        ]}
        rows={ROWS}
        getRowId={(r) => r.id}
        caption="Staff"
        sort={{ columnId: 'name', direction: 'desc' }}
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /dept2/i }));
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: 'dept2', direction: 'asc' });
  });

  it('gives the sort handle a 24px target without growing the header row', () => {
    renderTable({ onSortChange: vi.fn() });
    // WCAG 2.5.8 via a transparent ::before overlay (ADR-0001).
    expect(screen.getByRole('button', { name: /name/i }).className).toContain('before:h-6');
  });
});

describe('DataTable · selection', () => {
  it('adds a select-all header checkbox only when selectable', () => {
    renderTable();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    renderTable({ selectable: true, onSelectionChange: vi.fn() });
    expect(screen.getByRole('checkbox', { name: /select all rows/i })).toBeInTheDocument();
  });

  it('is indeterminate when some but not all rows are selected', () => {
    renderTable({ selectable: true, selectedIds: ['r1'], onSelectionChange: vi.fn() });
    const all = screen.getByRole<HTMLInputElement>('checkbox', { name: /select all rows/i });
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
  });

  it('is checked when every row is selected', () => {
    renderTable({
      selectable: true,
      selectedIds: ['r1', 'r2', 'r3'],
      onSelectionChange: vi.fn(),
    });
    const all = screen.getByRole<HTMLInputElement>('checkbox', { name: /select all rows/i });
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
  });

  it('selects every row from empty, and clears from full', async () => {
    const onSelectionChange = vi.fn();
    const { unmount } = renderTable({ selectable: true, onSelectionChange });
    await userEvent.click(screen.getByRole('checkbox', { name: /select all rows/i }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['r1', 'r2', 'r3']);
    unmount();

    renderTable({ selectable: true, selectedIds: ['r1', 'r2', 'r3'], onSelectionChange });
    await userEvent.click(screen.getByRole('checkbox', { name: /select all rows/i }));
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('toggles a single row without disturbing the rest', async () => {
    const onSelectionChange = vi.fn();
    renderTable({ selectable: true, selectedIds: ['r2'], onSelectionChange });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select row r1' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['r2', 'r1']);
  });

  it('marks selected rows with aria-selected', () => {
    renderTable({ selectable: true, selectedIds: ['r1'], onSelectionChange: vi.fn() });
    expect(screen.getAllByRole('row')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('disables select-all when there is nothing to select', () => {
    renderTable({ rows: [], selectable: true, onSelectionChange: vi.fn() });
    expect(screen.getByRole('checkbox', { name: /select all rows/i })).toBeDisabled();
  });

  it('does not fire the row click when the row checkbox is clicked', async () => {
    const onRowClick = vi.fn();
    renderTable({
      selectable: true,
      onSelectionChange: vi.fn(),
      onRowClick,
    });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select row r1' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('DataTable · loading, error and empty', () => {
  it('renders skeleton rows and marks the table busy while loading', () => {
    const { container } = renderTable({ loading: true, loadingRowCount: 4 });
    expect(container.querySelector('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('row')).toHaveLength(5); // header + 4 skeletons
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('defaults to five skeleton rows', () => {
    renderTable({ loading: true });
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('renders the error state with a retry, in place of rows', async () => {
    const onRetry = vi.fn();
    renderTable({ error: { title: 'Could not load staff', onRetry } });
    expect(screen.getByText('Could not load staff')).toBeInTheDocument();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('KEEPS the header when empty, unlike DataGrid', () => {
    renderTable({ rows: [] });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(COLUMNS.length);
    expect(screen.getByText('No records to show')).toBeInTheDocument();
  });

  it('accepts a custom empty state', () => {
    renderTable({ rows: [], emptyState: <p>No staff match these filters.</p> });
    expect(screen.getByText('No staff match these filters.')).toBeInTheDocument();
  });

  it('prefers loading over empty when both would apply', () => {
    renderTable({ rows: [], loading: true });
    expect(screen.queryByText('No records to show')).not.toBeInTheDocument();
  });
});

describe('DataTable · density', () => {
  it('is 40px comfortable, with py-1.5 cells', () => {
    renderTable();
    expect(screen.getAllByRole('row')[1]?.className).toContain('h-10');
    expect(screen.getByText('Ada').className).toContain('py-1.5');
  });

  it('is 32px dense, with py-px cells', () => {
    renderTable({ dense: true });
    expect(screen.getAllByRole('row')[1]?.className).toContain('h-8');
    expect(screen.getByText('Ada').className).toContain('py-px');
  });

  it('keeps the header row at 32px in both densities', () => {
    const { unmount } = renderTable();
    expect(screen.getAllByRole('row')[0]?.className).toContain('h-8');
    unmount();
    renderTable({ dense: true });
    expect(screen.getAllByRole('row')[0]?.className).toContain('h-8');
  });
});

/* ── Wave 2c-a additions ──────────────────────────────────────── */

describe('DataTable · hideBelowMd (2c-a)', () => {
  const columns: readonly DataTableColumn<Row>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name },
    { id: 'dept', header: 'Department', cell: (r) => r.dept, hideBelowMd: true },
  ];

  it('hides the header and its cells below md, together', () => {
    renderTable({ columns });
    const header = screen.getByRole('columnheader', { name: 'Department' });
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('md:table-cell');

    const cell = screen.getByText('Cardiology');
    expect(cell.className).toContain('hidden');
    expect(cell.className).toContain('md:table-cell');
  });

  it('leaves other columns untouched', () => {
    renderTable({ columns });
    expect(screen.getByRole('columnheader', { name: 'Name' }).className).not.toContain('hidden');
  });

  it('hides the matching skeleton cell while loading', () => {
    const { container } = renderTable({ columns, loading: true, loadingRowCount: 1 });
    const skeletonCells = container.querySelectorAll('tbody td');
    expect(skeletonCells[1]?.className).toContain('md:table-cell');
  });
});

describe('DataTable · keyboard row activation (2c-a)', () => {
  it('stays inert when there is no onRowClick', () => {
    renderTable();
    const row = screen.getAllByRole('row')[1];
    expect(row).not.toHaveAttribute('tabindex');
    expect(row?.className ?? '').not.toContain('cursor-pointer');
  });

  it('puts clickable rows in the tab order', () => {
    renderTable({ onRowClick: vi.fn() });
    for (const row of screen.getAllByRole('row').slice(1)) {
      expect(row).toHaveAttribute('tabindex', '0');
    }
  });

  it('activates on click, Enter and Space', async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    const rows = screen.getAllByRole('row').slice(1);

    await userEvent.click(rows[0] as HTMLElement);
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0]);

    (rows[1] as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);

    (rows[2] as HTMLElement).focus();
    await userEvent.keyboard(' ');
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[2]);
  });

  it('ignores keys that are not Enter or Space', async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    (screen.getAllByRole('row')[1] as HTMLElement).focus();
    await userEvent.keyboard('{Escape}x{ArrowDown}');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('keeps rows as rows for assistive tech — the row is not relabelled a button', () => {
    // DataGrid used role="button", which costs the row its position in the
    // grid ("row 2 of 40"). Keeping role=row and adding a tab stop preserves
    // both the table semantics and the keyboard affordance.
    renderTable({ onRowClick: vi.fn() });
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1);
  });

  it('does not fire the row handler for a keypress aimed at a control inside a cell', async () => {
    /*
     * Scoped to the KEYDOWN path, which is what 2c-a introduces. The row's
     * own handler ignores events whose target is not the row.
     *
     * The click path is deliberately left alone: an inner control's Enter
     * also produces a click, and that click bubbles to the row exactly as it
     * always has. Consumers opt out per control — `AppointmentRowActions`
     * already calls `stopPropagation` — and changing that globally would be
     * a behaviour change to the ten existing callers, which 2c-a is not
     * allowed to make. 2c-b must apply the same treatment to any admin cell
     * that hosts a control inside a clickable row.
     */
    const onRowClick = vi.fn();
    const onInner = vi.fn();
    renderTable({
      onRowClick,
      columns: [
        {
          id: 'name',
          header: 'Name',
          cell: (r: Row) => (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onInner();
              }}
            >
              {r.name}
            </button>
          ),
        },
      ],
    });
    screen.getByRole('button', { name: 'Ada' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onInner).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('DataTable · rowHeader (2c-a)', () => {
  it('renders the flagged column as <th scope="row">', () => {
    renderTable({
      columns: [
        { id: 'name', header: 'Name', cell: (r: Row) => r.name, rowHeader: true },
        { id: 'dept', header: 'Department', cell: (r: Row) => r.dept },
      ],
    });
    const rowHeaders = screen.getAllByRole('rowheader');
    expect(rowHeaders).toHaveLength(ROWS.length);
    expect(rowHeaders[0]).toHaveAttribute('scope', 'row');
    expect(rowHeaders[0]?.textContent).toBe('Ada');
  });

  it('leaves every other cell a <td>', () => {
    renderTable({
      columns: [
        { id: 'name', header: 'Name', cell: (r: Row) => r.name, rowHeader: true },
        { id: 'dept', header: 'Department', cell: (r: Row) => r.dept },
      ],
    });
    expect(screen.getAllByRole('cell')).toHaveLength(ROWS.length);
  });

  it('defaults off, so existing tables are unchanged', () => {
    renderTable();
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });
});

describe('DataTable · bare (2c-a)', () => {
  it('drops the card so a Panel can supply the frame', () => {
    const { container } = renderTable({ bare: true });
    const shell = container.firstElementChild;
    expect(shell?.className).toContain('overflow-x-auto');
    expect(shell?.className).not.toContain('rounded-surface');
    expect(shell?.className).not.toContain('border-border');
    expect(shell?.className).not.toContain('bg-surface');
  });

  it('keeps the horizontal scroller, so the page body never scrolls sideways', () => {
    const { container } = renderTable({ bare: true });
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  it('defaults off', () => {
    const { container } = renderTable();
    expect(container.firstElementChild?.className).toContain('rounded-surface');
  });
});

describe('DataTable · zebra (2c-a)', () => {
  it('can be turned off for a flat console list', () => {
    renderTable({ zebra: false });
    const row = screen.getAllByRole('row')[1];
    expect(row?.className ?? '').not.toContain('even:bg-background');
  });

  it('keeps the hover affordance when flat', () => {
    renderTable({ zebra: false });
    expect(screen.getAllByRole('row')[1]?.className).toContain('hover:bg-surface-sunken');
  });

  it('defaults on', () => {
    renderTable();
    expect(screen.getAllByRole('row')[1]?.className).toContain('even:bg-background');
  });
});

describe('DataTable · density preset (2c-a)', () => {
  it('offers an `admin` density that matches DataGrid row height', () => {
    renderTable({ density: 'admin' });
    // DataGrid rows are py-3 with no min-height; `admin` reproduces exactly
    // that so the migration is not a 4px compression.
    expect(screen.getByText('Ada').className).toContain('py-3');
    expect(screen.getAllByRole('row')[1]?.className ?? '').not.toMatch(/\bh-\d/);
  });

  it('gives the admin header DataGrid padding rather than a fixed 32px row', () => {
    renderTable({ density: 'admin' });
    expect(screen.getByRole('columnheader', { name: 'Name' }).className).toContain('py-2.5');
    expect(screen.getAllByRole('row')[0]?.className ?? '').not.toMatch(/\bh-\d/);
  });

  it('leaves comfortable and dense exactly as they were', () => {
    const { unmount } = renderTable({ density: 'comfortable' });
    expect(screen.getAllByRole('row')[1]?.className).toContain('h-10');
    expect(screen.getByText('Ada').className).toContain('py-1.5');
    unmount();

    renderTable({ density: 'dense' });
    expect(screen.getAllByRole('row')[1]?.className).toContain('h-8');
    expect(screen.getByText('Ada').className).toContain('py-px');
  });

  it('still honours the legacy `dense` boolean', () => {
    renderTable({ dense: true });
    expect(screen.getAllByRole('row')[1]?.className).toContain('h-8');
  });

  /*
   * Three details that jsdom cannot see but the browser can. Each was found
   * by measuring the live pages against DataGrid, and each is pinned here so
   * a refactor cannot quietly undo it. Measured figures, both themes:
   * header 38.4px, table height 333px (5 rows) / 1454px (24 rows).
   */
  it('middle-aligns admin cells and headers, so a two-line cell adds no height', () => {
    renderTable({ density: 'admin' });
    expect(screen.getByText('Ada').className).toContain('align-middle');
    expect(screen.getByRole('columnheader', { name: 'Name' }).className).toContain('align-middle');
  });

  it('leaves comfortable and dense on baseline alignment', () => {
    const { unmount } = renderTable({ density: 'comfortable' });
    expect(screen.getByText('Ada').className).not.toContain('align-middle');
    unmount();
    renderTable({ density: 'dense' });
    expect(screen.getByText('Ada').className).not.toContain('align-middle');
  });

  it('sizes admin text on the TABLE, because cn cannot keep it on a cell', () => {
    /*
     * tailwind-merge does not know this project's font-size scale, reads
     * `text-body-sm` as a colour and drops it in favour of the
     * `text-text-primary` beside it. Inheriting from the table is how
     * DataGrid did it and is worth 2px per row.
     */
    const { container } = renderTable({ density: 'admin' });
    expect(container.querySelector('table')?.className).toContain('text-body-sm');
  });

  it('does not put a font size on the table for the other densities', () => {
    const { container } = renderTable();
    expect(container.querySelector('table')?.className).not.toContain('text-body-sm');
  });

  it('separates admin rows with a bottom border, dropping it on the last row', () => {
    renderTable({ density: 'admin' });
    const row = screen.getAllByRole('row')[1];
    expect(row?.className).toContain('border-b');
    expect(row?.className).toContain('last:border-b-0');
    expect(row?.className).not.toContain('border-t');
  });

  it('keeps the top-border separator for comfortable and dense', () => {
    renderTable();
    expect(screen.getAllByRole('row')[1]?.className).toContain('border-t');
  });
});

describe('DataTable · the admin migration configuration (2c-a)', () => {
  /**
   * Not a migration — the consumers move in 2c-b. This pins the exact prop
   * set that reproduces DataGrid, so 2c-b has one configuration to apply
   * rather than seven judgement calls.
   */
  const adminConfig = {
    bare: true,
    zebra: false,
    density: 'admin',
    stickyHeader: false,
    headerVoice: 'overline',
  } as const;

  it('reproduces the DataGrid look and geometry', () => {
    const { container } = renderTable({ ...adminConfig, caption: 'Clinic staff' });

    expect(container.firstElementChild?.className).not.toContain('rounded-surface');
    expect(screen.getAllByRole('row')[1]?.className ?? '').not.toContain('even:bg-background');
    expect(screen.getByText('Ada').className).toContain('py-3');
    expect(container.querySelector('thead')?.className ?? '').not.toContain('sticky');
    expect(screen.getByText('Name').className).toContain('tracking-[0.12em]');
  });

  it('still names the table for assistive tech', () => {
    renderTable({ ...adminConfig, caption: 'Clinic staff' });
    expect(screen.getByRole('table', { name: 'Clinic staff' })).toBeInTheDocument();
  });

  it('keeps loading, error and empty available — capabilities DataGrid lacked', () => {
    const { unmount } = renderTable({ ...adminConfig, loading: true, loadingRowCount: 2 });
    expect(screen.getAllByRole('row')).toHaveLength(3);
    unmount();

    renderTable({ ...adminConfig, rows: [], emptyState: <p>No staff match these filters.</p> });
    expect(screen.getByText('No staff match these filters.')).toBeInTheDocument();
    // Unlike DataGrid, the header survives an empty result.
    expect(screen.getAllByRole('columnheader')).toHaveLength(COLUMNS.length);
  });

  it('renders the admin header voice without changing the default voice', () => {
    const { unmount } = renderTable({ headerVoice: 'overline' });
    expect(screen.getByText('Name').className).toContain('tracking-[0.12em]');
    unmount();

    renderTable();
    const header = screen.getByRole('columnheader', { name: 'Name' });
    expect(header.className).toContain('tracking-wider');
  });
});

describe('DataTable · a consumer-shaped smoke case', () => {
  it('renders a sortable, selectable worklist end to end', async () => {
    const onSortChange = vi.fn();
    const onSelectionChange = vi.fn();
    renderTable({
      selectable: true,
      selectedIds: ['r2'],
      onSelectionChange,
      sort: { columnId: 'name', direction: 'asc' },
      onSortChange,
    });

    const table = screen.getByRole('table', { name: 'Staff' });
    expect(within(table).getAllByRole('row')).toHaveLength(ROWS.length + 1);

    await userEvent.click(within(table).getByRole('button', { name: /name/i }));
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: 'name', direction: 'desc' });

    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select row r3' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['r2', 'r3']);
  });
});

/* ── The horizontal scroller as a keyboard-operable region ────── */

/**
 * Measured at 1440 px — a standard desktop width, not a phone — the five
 * doctor worklists hide 107 to 450 px of columns behind a 2 px overlay
 * scrollbar. The labs table's Status column is off-screen entirely.
 *
 * A region that scrolls has to be reachable without a pointer (WCAG 2.1.1,
 * and axe's `scrollable-region-focusable` states it directly). jsdom reports
 * every element as 0×0, so the measurement is driven by stubbing the two
 * properties the component compares — which is also the only way to test the
 * *negative* case, since a real browser would have to be resized to produce
 * it.
 */
function stubScrollGeometry(scrollWidth: number, clientWidth: number) {
  const scrollDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    'scrollWidth',
  );
  const clientDescriptor = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype,
    'clientWidth',
  );
  // Only the scroller `div` reports geometry; the table inside it stays 0, so
  // the component cannot accidentally measure the wrong element.
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'DIV' ? scrollWidth : 0;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'DIV' ? clientWidth : 0;
    },
  });
  return () => {
    if (scrollDescriptor) {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', scrollDescriptor);
    }
    if (clientDescriptor) {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', clientDescriptor);
    }
  };
}

describe('DataTable · the horizontal scroller', () => {
  it('is a named, focusable region when the columns do not fit', () => {
    const restore = stubScrollGeometry(1200, 800);
    try {
      renderTable();
      const region = screen.getByRole('region', { name: 'Staff' });

      expect(region).toHaveAttribute('tabindex', '0');
      expect(region).toHaveClass('overflow-x-auto');
    } finally {
      restore();
    }
  });

  it('adds no tab stop and no landmark when the columns fit', () => {
    // The negative case is the one worth pinning. A permanent tab stop in
    // front of every table would put a stop that scrolls nothing into the
    // sequence, and a landmark per table into the region list.
    const restore = stubScrollGeometry(800, 800);
    try {
      renderTable();

      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Staff' }).closest('div')).not.toHaveAttribute(
        'tabindex',
      );
    } finally {
      restore();
    }
  });

  it('does not treat a sub-pixel rounding difference as overflow', () => {
    // Layout rounding routinely reports a table that fits exactly as one
    // pixel wider than its container.
    const restore = stubScrollGeometry(801, 800);
    try {
      renderTable();

      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('paints a focus ring once it is focusable, so the tab stop is visible', () => {
    const restore = stubScrollGeometry(1200, 800);
    try {
      renderTable();

      expect(screen.getByRole('region', { name: 'Staff' })).toHaveClass(
        'focus-visible:shadow-focus',
      );
    } finally {
      restore();
    }
  });

  it('takes its name from the same caption the table is named by', () => {
    const restore = stubScrollGeometry(1200, 800);
    try {
      renderTable({ caption: 'Laboratory results' });

      expect(screen.getByRole('region', { name: 'Laboratory results' })).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Laboratory results' })).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

/* ── Sticky first column (DS §8.19, DEC-015) ──────────────────── */

/**
 * DS §8.19: "horizontal scroll within the container with sticky first
 * column". The first attempt was reverted (§11.4) because a pinned cell that
 * inherits its row's background is see-through in dark mode, where the row
 * tints are 16% alpha. The pinned cell now paints the table's opaque surface
 * and lays the row's own tint over it as an image layer — the same colour the
 * row shows, never transparent. jsdom paints nothing, so these pin the
 * contract; the rendered result is measured in a browser (§19).
 */
describe('DataTable · sticky first column', () => {
  function firstColumnCells() {
    const table = screen.getByRole('table', { name: 'Staff' });
    const header = within(table).getByRole('columnheader', { name: /Name/ });
    const body = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelectorAll('td, th')[0] as HTMLElement);
    return { header, body, table };
  }

  it('pins the first column only while the table overflows', () => {
    const restore = stubScrollGeometry(1200, 800);
    try {
      renderTable();
      const { header, body, table } = firstColumnCells();
      for (const cell of [header, ...body]) expect(cell).toHaveClass('sticky');
      // Logical, so it pins the inline start in Arabic and Persian too.
      for (const cell of [header, ...body]) expect(cell.style.insetInlineStart).toBe('0px');
      const second = within(table).getByRole('columnheader', { name: 'Department' });
      expect(second).not.toHaveClass('sticky');
    } finally {
      restore();
    }
  });

  it('pins nothing when the columns fit', () => {
    const restore = stubScrollGeometry(800, 800);
    try {
      renderTable();
      const { header, body } = firstColumnCells();
      for (const cell of [header, ...body]) expect(cell).not.toHaveClass('sticky');
    } finally {
      restore();
    }
  });

  it('paints a pinned cell opaque, with its row’s tint over it', () => {
    const restore = stubScrollGeometry(1200, 800);
    try {
      renderTable();
      const { header, body } = firstColumnCells();
      for (const cell of body) {
        expect(cell).toHaveClass('bg-surface');
        expect(cell).toHaveClass('bg-[image:linear-gradient(var(--row-bg),var(--row-bg))]');
      }
      // The header row is surface-sunken, which is opaque in both themes.
      expect(header).toHaveClass('bg-surface-sunken');
    } finally {
      restore();
    }
  });

  it('gives every row its background as --row-bg, so a pinned cell can match it', () => {
    renderTable({ selectable: true, selectedIds: ['r2'], onSelectionChange: vi.fn() });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveClass('[--row-bg:transparent]');
    expect(rows[0]).toHaveClass('hover:[--row-bg:var(--color-surface-sunken)]');
    expect(rows[0]).toHaveClass('even:[--row-bg:var(--color-background)]');
    expect(rows[1]).toHaveClass('bg-primary-subtle');
    expect(rows[1]).toHaveClass('[--row-bg:var(--color-primary-subtle)]');
    expect(rows[1]).not.toHaveClass('[--row-bg:transparent]');
  });

  it('pins the selection column too, and offsets the first column by its width', () => {
    const restore = stubScrollGeometry(1200, 800);
    const rect = vi
      .spyOn(window.HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const width = this.dataset.pinnedSelect !== undefined ? 44 : 0;
        return {
          width,
          height: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON() {},
        };
      });
    try {
      renderTable({ selectable: true, selectedIds: [], onSelectionChange: vi.fn() });
      const selectAll = screen.getByRole('checkbox', { name: 'Select all rows' }).closest('th');
      expect(selectAll).toHaveClass('sticky');
      expect(selectAll?.style.insetInlineStart).toBe('0px');
      const { header, body } = firstColumnCells();
      // Row cells: [checkbox, Name, …] — the first data cell is the second.
      const nameCells = screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelectorAll('td, th')[1] as HTMLElement);
      expect(body[0]).toHaveClass('sticky'); // the row's checkbox cell
      for (const cell of [header, ...nameCells]) expect(cell.style.insetInlineStart).toBe('44px');
    } finally {
      rect.mockRestore();
      restore();
    }
  });

  it('keeps a selected row’s bar on the pinned leftmost cell, which would otherwise cover it', () => {
    const restore = stubScrollGeometry(1200, 800);
    try {
      renderTable({ selectable: true, selectedIds: ['r1'], onSelectionChange: vi.fn() });
      const selected = screen.getAllByRole('row')[1] as HTMLElement;
      const leftmost = selected.querySelectorAll('td, th')[0];
      expect(leftmost?.className).toMatch(/inset_2px_0_0_0_var\(--color-primary\)/);
      const other = (screen.getAllByRole('row')[2] as HTMLElement).querySelectorAll('td, th')[0];
      expect(other?.className).not.toMatch(/var\(--color-primary\)/);
    } finally {
      restore();
    }
  });
});
