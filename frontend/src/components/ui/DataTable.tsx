import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { cn } from '@/utils/cn';

import { Checkbox } from './Checkbox';

/**
 * DataTable — DS §8.19.
 * Semantic <table> in a card-style container; sticky sunken header;
 * sortable columns announce aria-sort; selection column with select-all
 * (indeterminate); loading renders skeleton rows; empty and error states
 * render inside the body. Generic over the row type — no domain imports
 * (FRONTEND_ARCHITECTURE §8.2). P1 toolbar, filters, and pagination attach
 * around this component (SearchBar / FilterBar / Pagination).
 *
 * ## The horizontal scroller is a keyboard-operable region — when it scrolls
 *
 * These tables are wide. Measured at 1440 px, a standard desktop width, the
 * five doctor worklists hide between 107 px and 450 px of columns — the labs
 * table's Status column is off-screen entirely — and the scrollbar over it is
 * a 2 px overlay that appears only while the pointer moves.
 *
 * A region that scrolls must be reachable without a pointer (WCAG 2.1.1; the
 * `scrollable-region-focusable` rule states it directly). A keyboard user can
 * currently only reach the hidden columns *sideways*, by tabbing to a control
 * inside them and letting the browser scroll to it — which works only where
 * such a control exists and never lets anyone simply read the far columns. So
 * the scroller takes `tabIndex={0}` and is named as a region.
 *
 * **Only while it actually overflows.** A permanent tab stop in front of every
 * table would add a stop that does nothing on a wide screen, and DX-13's rule
 * applies — a second control that does nothing is how a screen-reader user
 * hears everything twice with no way to tell which copy does what. The
 * container measures itself and drops back out of the tab order when the
 * columns fit.
 */
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

export interface DataTableColumn<T> {
  readonly id: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  readonly sortable?: boolean;
  readonly align?: 'left' | 'right' | 'center';
  /** Right-aligns and applies tabular figures (DS §3.1). */
  readonly numeric?: boolean;
  /** Monospace for IDs/codes where scannability matters. */
  readonly mono?: boolean;
  /** CSS width (e.g. "160px", "20%"). */
  readonly width?: string;
  /**
   * Drop this column below the md breakpoint to keep a wide table readable
   * on a phone. Applied to the header, the body cell and the loading
   * skeleton alike, so the three never disagree about the column count.
   */
  readonly hideBelowMd?: boolean;
  /**
   * Render this column's body cells as `<th scope="row">`. Use it for the
   * value that identifies the row — an analyte name, a permission — so a
   * screen reader announces it when reading any other cell in that row.
   * At most one column should claim it.
   */
  readonly rowHeader?: boolean;
}

/**
 * Row geometry. `comfortable` (40px) and `dense` (32px) are the platform's
 * own; `admin` reproduces the Administration Center's taller, min-height-less
 * row so that area can move onto this table without a density change.
 */
export type DataTableDensity = 'comfortable' | 'dense' | 'admin';

/**
 * Header typography. `default` is the platform's; `overline` is the admin
 * area's wider-tracked voice. A prop rather than a fork so the two areas can
 * share one engine without either one's headers moving.
 */
export type DataTableHeaderVoice = 'default' | 'overline';

/**
 * The admin `Overline` label, inlined rather than imported: `components/ui`
 * is a platform layer and may not reach into `features` (FRONTEND_ARCHITECTURE
 * §1.2). Kept identical to the `Overline` in
 * `features/admin/components/primitives.tsx` — if that one is revalued, this
 * has to follow, and the admin-configuration test is what catches the drift.
 */
const OVERLINE_LABEL = 'text-caption font-semibold uppercase tracking-[0.12em] text-text-tertiary';

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  getRowId: (row: T) => string;
  /** Visually hidden table description for screen readers (DS §11.5). */
  caption: string;
  sort?: SortState | undefined;
  onSortChange?: ((sort: SortState) => void) | undefined;
  /** Enables the 48px checkbox selection column. */
  selectable?: boolean;
  selectedIds?: readonly string[] | undefined;
  onSelectionChange?: ((ids: readonly string[]) => void) | undefined;
  /**
   * Activating a row. Rows become focusable and respond to Enter and Space
   * as well as the pointer — the row keeps `role="row"`, so assistive tech
   * still reports its position in the table rather than announcing a button.
   */
  onRowClick?: ((row: T) => void) | undefined;
  /** @deprecated Prefer `density`. Kept so existing callers do not move. */
  dense?: boolean;
  density?: DataTableDensity;
  /** Drop the card container so a surrounding Panel can supply the frame. */
  bare?: boolean;
  /** Alternating row tint. Off gives the flat "console list" reading. */
  zebra?: boolean;
  headerVoice?: DataTableHeaderVoice;
  stickyHeader?: boolean;
  loading?: boolean;
  loadingRowCount?: number;
  /** Section-level error (DS §8.33): message + Retry inside the body. */
  error?: { readonly title?: string; readonly onRetry?: () => void } | undefined;
  /** Custom empty state; defaults to a neutral EmptyState. */
  emptyState?: ReactNode;
  /**
   * Per-row tint, for the rare case where a row's own state is the message
   * — UX §2.6's "critical rows tint error-subtle", and nothing decorative.
   * Returned classes are appended after the zebra/hover set and before the
   * selection treatment, so selecting a row still reads as selected.
   */
  getRowClassName?: ((row: T) => string | undefined) | undefined;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  sort,
  onSortChange,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  onRowClick,
  dense = false,
  density,
  bare = false,
  zebra = true,
  headerVoice = 'default',
  stickyHeader = true,
  loading = false,
  loadingRowCount = 5,
  error,
  emptyState,
  getRowClassName,
  className,
}: DataTableProps<T>) {
  const totalColumns = columns.length + (selectable ? 1 : 0);
  const allIds = rows.map(getRowId);
  const selectedSet = new Set(selectedIds);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id));
  const someSelected = allIds.some((id) => selectedSet.has(id));

  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : allIds);
  };

  const toggleRow = (id: string) => {
    if (!onSelectionChange) return;
    onSelectionChange(
      selectedSet.has(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id],
    );
  };

  const cycleSort = (columnId: string) => {
    if (!onSortChange) return;
    const direction: SortDirection =
      sort?.columnId === columnId && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ columnId, direction });
  };

  const cellAlign = (column: DataTableColumn<T>) =>
    column.numeric || column.align === 'right'
      ? 'text-end'
      : column.align === 'center'
        ? 'text-center'
        : 'text-start';

  /*
   * `dense` predates `density` and still wins nothing: an explicit `density`
   * is authoritative, and the boolean only survives so the ten existing
   * callers keep their geometry without an edit.
   */
  const resolvedDensity: DataTableDensity = density ?? (dense ? 'dense' : 'comfortable');

  /*
   * `dense` has to reach the cell padding, not just the row's min-height:
   * a row's real height is its tallest cell's content plus this padding,
   * so at the comfortable 6px the min-height never binds and a dense table
   * came out exactly as tall as a normal one. 1px keeps a worklist row at
   * the 44px scanning target once the separator border is counted
   * (ADR-0001); the cells carry their own internal spacing.
   *
   * `admin` deliberately sets NO min-height. The Administration Center's
   * rows are as tall as their padded content and nothing else, so pinning a
   * height here would have compressed every admin row by ~4px — which is the
   * density regression the consolidation is supposed to avoid.
   */
  const rowHeight = resolvedDensity === 'admin' ? '' : resolvedDensity === 'dense' ? 'h-8' : 'h-10';
  const cellPadding =
    resolvedDensity === 'admin' ? 'py-3' : resolvedDensity === 'dense' ? 'py-px' : 'py-1.5';
  const headerRowHeight = resolvedDensity === 'admin' ? '' : 'h-8';
  const headerCellPadding = resolvedDensity === 'admin' ? 'py-2.5' : '';
  /*
   * `align-middle` belongs to the admin density, not to every table.
   *
   * Cells default to `baseline`, which is invisible while every cell in a row
   * is one line tall and costs 2px the moment one of them is two — a staff
   * row carrying a name over a job title measured 59px under `DataGrid` and
   * 61px without this. `DataGrid` set it explicitly; reproducing the density
   * means reproducing that. It is scoped to `admin` rather than applied
   * globally because the ten existing callers were built and measured against
   * baseline alignment, and moving them is not this wave's business.
   */
  const cellAlignY = resolvedDensity === 'admin' ? 'align-middle' : '';
  /*
   * The separator moves to the BOTTOM of the row for the admin density,
   * mirroring `DataGrid`. With `border-collapse` the shared 1px line is
   * apportioned between the two adjacent rows, and moving it from `border-t`
   * to `border-b` changes that apportionment: measured against the live
   * pages, top borders gave 59.0px rows where `DataGrid` gave 58.8px. A fifth
   * of a pixel is invisible on one row and 2px over a screenful, and there is
   * no reason to accept it when mirroring the original costs nothing.
   */
  const rowBorder =
    resolvedDensity === 'admin'
      ? 'border-b border-border last:border-b-0'
      : 'border-t border-border';
  const isOverline = headerVoice === 'overline';
  const showBody = !loading && !error && rows.length > 0;

  /*
   * Enter and Space activate a focused row, but only when the row itself is
   * the target. A button, link or checkbox inside a cell must keep its own
   * keyboard behaviour — otherwise opening a drawer from a row action would
   * also fire the row's own click.
   */
  const handleRowKeyDown = (row: T) => (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onRowClick?.(row);
  };

  /*
   * Does the scroller actually scroll? Re-measured on resize of the container
   * AND of the table, because either can change the answer: the viewport
   * narrowing, or a column appearing when data arrives.
   */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const selectColumnRef = useRef<HTMLTableCellElement | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const [selectColumnWidth, setSelectColumnWidth] = useState(0);

  const measure = useCallback(() => {
    const node = scrollerRef.current;
    if (node === null) return;
    // 1px of slack: sub-pixel layout rounding otherwise reports a table that
    // fits exactly as overflowing, which would add a tab stop that scrolls
    // nothing.
    setScrollable(node.scrollWidth > node.clientWidth + 1);
    // The first data column pins beside the selection column, so it needs
    // that column's real width — 40px with a mouse, wider on touch, where
    // the checkbox reserves its 44px gutter (DEC-008).
    setSelectColumnWidth(selectColumnRef.current?.getBoundingClientRect().width ?? 0);
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node === null) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const table = node.querySelector('table');
    if (table !== null) observer.observe(table);
    return () => observer.disconnect();
  });

  /*
   * Sticky first column (DS §8.19), while — and only while — the table
   * scrolls sideways. The selection column, when there is one, pins with it.
   *
   * A pinned cell must be opaque or the columns sliding under it show
   * through. Inheriting the row's background is not enough: in dark mode the
   * row tints are 16% alpha (§11.4, which is why the first attempt was
   * reverted). So every row publishes its background as `--row-bg`, mirroring
   * its `bg-*` classes variant for variant, and a pinned cell paints the
   * table's opaque surface with that tint laid over it as an image — exactly
   * the colour the row shows, and never see-through. Logical `inset-inline-
   * start`, so it pins the right-hand edge in Arabic and Persian.
   */
  const pinned = scrollable;
  const firstColumnId = columns[0]?.id;
  const firstColumnOffset = selectable ? selectColumnWidth : 0;
  const PINNED_BODY =
    'sticky z-[1] bg-surface bg-[image:linear-gradient(var(--row-bg),var(--row-bg))]';
  /** The pinned edge — an inset line, because borders do not travel with a sticky cell. */
  const PINNED_EDGE =
    'shadow-[inset_-1px_0_0_0_var(--color-border)] rtl:shadow-[inset_1px_0_0_0_var(--color-border)]';
  const PINNED_HEADER = cn('sticky z-[2]', bare ? 'bg-surface' : 'bg-surface-sunken');
  /** A selected row's bar is the row's inset shadow, which an opaque pinned cell covers. */
  const SELECTED_BAR = (edge: boolean) =>
    edge
      ? 'shadow-[inset_2px_0_0_0_var(--color-primary),inset_-1px_0_0_0_var(--color-border)] rtl:shadow-[inset_-2px_0_0_0_var(--color-primary),inset_1px_0_0_0_var(--color-border)]'
      : 'shadow-[inset_2px_0_0_0_var(--color-primary)] rtl:shadow-[inset_-2px_0_0_0_var(--color-primary)]';

  return (
    <div
      ref={scrollerRef}
      /*
       * `role="region"` only alongside the tab stop. A landmark region on
       * every table would add one to the landmark list per table whether or
       * not it has anything a reader needs to do there; the pair exists to
       * announce "this scrolls, and you can scroll it".
       */
      {...(scrollable ? { tabIndex: 0, role: 'region' as const, 'aria-label': caption } : {})}
      className={cn(
        'overflow-x-auto',
        // The focus ring belongs on the scroller once it is focusable — an
        // invisible tab stop is worse than no tab stop.
        scrollable && 'focus-visible:outline-none focus-visible:shadow-focus',
        !bare && 'rounded-surface border border-border bg-surface',
        className,
      )}
    >
      {/*
        `text-body-sm` sits on the TABLE for the admin density, not on each
        cell, because `cn` cannot keep it on a cell: tailwind-merge does not
        know this project's font-size scale, reads `text-body-sm` as a colour,
        and drops it in favour of the `text-text-primary` beside it. Inheriting
        from the table is what `DataGrid` did and is why its rows measured
        59px where cell-level sizing gave 61px. The other densities are left
        exactly as they were — they pin height with `h-10`/`h-8`, so the same
        quirk never showed, and changing it here would move ten live tables.
      */}
      <table
        className={cn('w-full border-collapse', resolvedDensity === 'admin' && 'text-body-sm')}
        aria-busy={loading || undefined}
      >
        <caption className="sr-only">{caption}</caption>
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <tr
            className={cn(headerRowHeight, 'border-b border-border', !bare && 'bg-surface-sunken')}
          >
            {selectable ? (
              <th
                ref={selectColumnRef}
                data-pinned-select=""
                scope="col"
                className={cn('w-10 px-3', pinned && PINNED_HEADER)}
                style={pinned ? { insetInlineStart: '0px' } : undefined}
              >
                <Checkbox
                  aria-label="Select all rows"
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={toggleAll}
                  disabled={loading || rows.length === 0}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const isSorted = sort?.columnId === column.id;
              const SortIcon = isSorted
                ? sort.direction === 'asc'
                  ? ArrowUp
                  : ArrowDown
                : ChevronsUpDown;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={
                    isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  style={{
                    ...(column.width !== undefined ? { width: column.width } : {}),
                    ...(pinned && column.id === firstColumnId
                      ? { insetInlineStart: `${String(firstColumnOffset)}px` }
                      : {}),
                  }}
                  className={cn(
                    'whitespace-nowrap px-3',
                    pinned && column.id === firstColumnId && cn(PINNED_HEADER, PINNED_EDGE),
                    /*
                     * The two voices differ in STRUCTURE, not only in class
                     * names. The admin header sizes its label on an inner
                     * span and leaves the cell itself at body-sm, so the
                     * header row's line box — and therefore its height — is
                     * 2px taller than a cell sized at caption. Applying the
                     * overline classes to the `th` reproduced the letter
                     * spacing but lost those 2px; reproducing the span keeps
                     * the geometry identical (measured 38.4px, both themes).
                     */
                    isOverline
                      ? 'text-body-sm'
                      : 'text-caption font-semibold uppercase tracking-wider text-text-tertiary',
                    headerCellPadding,
                    cellAlignY,
                    cellAlign(column),
                    column.hideBelowMd && 'hidden md:table-cell',
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => cycleSort(column.id)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-control uppercase transition-colors duration-fast hover:text-text-primary',
                        // A sort handle is only as tall as its 20px caption.
                        // The overlay lifts the target to 24px (WCAG 2.5.8)
                        // without adding height to the header row; every
                        // handle is already wider than 24px.
                        "relative before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2 before:content-['']",
                        // On a coarse pointer it reserves 14px above and below
                        // and is at least 44px wide: a 44px target (DEC-008).
                        'touch-target [--touch-y:14px] touch:min-w-[44px]',
                        isSorted && 'text-text-primary',
                      )}
                    >
                      {isOverline ? (
                        <span className={OVERLINE_LABEL}>{column.header}</span>
                      ) : (
                        column.header
                      )}
                      <SortIcon
                        aria-hidden="true"
                        className={cn('h-4 w-4', isSorted ? 'text-primary' : 'text-text-disabled')}
                        strokeWidth={1.75}
                      />
                    </button>
                  ) : isOverline ? (
                    <span className={OVERLINE_LABEL}>{column.header}</span>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: loadingRowCount }, (_, index) => (
                <tr key={index} className={cn(rowHeight, rowBorder)}>
                  {selectable ? (
                    <td className="px-3">
                      <Skeleton className="h-[18px] w-[18px] rounded-control" />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn('px-3', column.hideBelowMd && 'hidden md:table-cell')}
                    >
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : null}
          {error ? (
            <tr>
              <td colSpan={totalColumns} className="p-8">
                <ErrorState
                  title={error.title ?? "Couldn't load this table"}
                  onRetry={error.onRetry}
                  className="border-0"
                />
              </td>
            </tr>
          ) : null}
          {!loading && !error && rows.length === 0 ? (
            <tr>
              <td colSpan={totalColumns}>
                {emptyState ?? <EmptyState title="No records to show" />}
              </td>
            </tr>
          ) : null}
          {showBody
            ? rows.map((row) => {
                const id = getRowId(row);
                const isSelected = selectedSet.has(id);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? handleRowKeyDown(row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-selected={selectable ? isSelected : undefined}
                    className={cn(
                      rowHeight,
                      rowBorder,
                      'transition-colors duration-fast',
                      // Each `bg-*` below has its `--row-bg` twin with the
                      // same variants, so a pinned cell resolves the same
                      // colour through the same cascade.
                      '[--row-bg:transparent]',
                      isSelected
                        ? 'bg-primary-subtle [--row-bg:var(--color-primary-subtle)] shadow-[inset_2px_0_0_0_var(--color-primary)]'
                        : cn(
                            zebra &&
                              'even:bg-background even:[--row-bg:var(--color-background)] even:hover:bg-surface-sunken even:hover:[--row-bg:var(--color-surface-sunken)]',
                            'hover:bg-surface-sunken hover:[--row-bg:var(--color-surface-sunken)]',
                            getRowClassName?.(row),
                          ),
                      onRowClick &&
                        'cursor-pointer focus-visible:bg-surface-sunken focus-visible:[--row-bg:var(--color-surface-sunken)]',
                    )}
                  >
                    {selectable ? (
                      <td
                        className={cn(
                          'px-3',
                          pinned && PINNED_BODY,
                          pinned && isSelected && SELECTED_BAR(false),
                        )}
                        style={pinned ? { insetInlineStart: '0px' } : undefined}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          aria-label={`Select row ${id}`}
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => {
                      const CellTag = column.rowHeader ? 'th' : 'td';
                      const pinnedCell = pinned && column.id === firstColumnId;
                      return (
                        <CellTag
                          key={column.id}
                          scope={column.rowHeader ? 'row' : undefined}
                          style={
                            pinnedCell
                              ? { insetInlineStart: `${String(firstColumnOffset)}px` }
                              : undefined
                          }
                          className={cn(
                            pinnedCell && PINNED_BODY,
                            pinnedCell &&
                              (isSelected && !selectable ? SELECTED_BAR(true) : PINNED_EDGE),
                            'px-3 text-body-sm font-normal text-text-primary',
                            cellPadding,
                            cellAlignY,
                            cellAlign(column),
                            column.numeric && 'tabular-nums',
                            column.mono && 'font-mono',
                            column.hideBelowMd && 'hidden md:table-cell',
                          )}
                        >
                          {column.cell(row)}
                        </CellTag>
                      );
                    })}
                  </tr>
                );
              })
            : null}
        </tbody>
      </table>
    </div>
  );
}
