import { useState } from 'react';

import { ArrowRight, Download, Table2, TrendingUp, Unplug } from 'lucide-react';
import { Link } from 'react-router-dom';

import { BarChart, DistributionBars, Heatmap, LineAreaChart, PieChart } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { DashboardWidget } from '@/components/patterns';
import { Badge, Chip, DataTable, type MenuEntry } from '@/components/ui';

import { datasetOf, formatValue } from './reports';
import type { ReportWidget, WidgetDataset, WidgetSummary, WidgetVisual } from './reports.types';

/**
 * One §3.8 widget — "range-aware, view-as-table, per-widget export".
 *
 * All three of those requirements are served from `datasetOf(widget.visual)`.
 * The chart draws the visual, the table renders the dataset, and the export
 * writes the same dataset the table just showed, so the three renderings agree
 * because they are one projection rather than because somebody kept them in
 * step. That is why this component takes a `ReportWidget` and not a chart plus
 * a table plus a file.
 *
 * ## Two ways to have nothing to show
 *
 * `empty` means the range came back with no rows: the note tells the reader to
 * widen it, and the widget will fill in when they do. `unavailable` means no
 * source for this figure exists anywhere in the client — a wider range will
 * never help — so it renders a different icon, different wording, and names
 * the service that would supply it. Collapsing the two into "No data" is the
 * version of this screen that quietly tells an operator to keep trying.
 */

export interface ReportWidgetCardProps {
  widget: ReportWidget;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Writes the file. Given the dataset on screen, never a rebuilt one. */
  onExport: (title: string, dataset: WidgetDataset) => void;
  className?: string | undefined;
}

export function ReportWidgetCard({
  widget,
  loading,
  error,
  onRetry,
  onExport,
  className,
}: ReportWidgetCardProps) {
  const [asTable, setAsTable] = useState(false);
  const dataset = widget.visual === null ? null : datasetOf(widget.visual);

  const menu: MenuEntry[] = [];
  if (dataset !== null) {
    menu.push({
      id: 'view',
      label: asTable ? 'View as chart' : 'View as table',
      icon: asTable ? TrendingUp : Table2,
      onSelect: () => {
        setAsTable((current) => !current);
      },
    });
    menu.push({
      id: 'export',
      label: 'Export this widget (CSV)',
      icon: Download,
      onSelect: () => {
        onExport(widget.title, dataset);
      },
    });
  }

  return (
    <DashboardWidget
      title={widget.title}
      subtitle={widget.caption}
      loading={loading}
      error={error ? { onRetry } : undefined}
      menu={menu.length > 0 ? menu : undefined}
      actions={
        widget.rangeOverride === null ? undefined : (
          /*
           * Three widgets answer a question the global range does not scope —
           * a live capacity snapshot, a fixed reporting window, a cohort grid.
           * The chip is not decoration: without it those numbers read as
           * range-scoped, and an administrator comparing them against the
           * widget above would be comparing two different windows.
           */
          <Chip label={widget.rangeOverride} />
        )
      }
      className={className}
    >
      {widget.availability === 'unavailable' ? (
        <EmptyState
          icon={Unplug}
          title="No source for this yet"
          {...(widget.note === null ? {} : { description: widget.note })}
          tone="neutral"
        />
      ) : widget.availability === 'empty' ? (
        <EmptyState
          title="Nothing in this period"
          {...(widget.note === null ? {} : { description: widget.note })}
          tone="neutral"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {widget.summary === null ? null : <SummaryLine summary={widget.summary} />}

          {asTable && dataset !== null ? (
            <WidgetTable title={widget.title} dataset={dataset} />
          ) : widget.visual === null ? null : (
            <WidgetChart title={widget.title} visual={widget.visual} />
          )}

          {widget.drillTo === null ? null : (
            <Link
              to={widget.drillTo}
              className="inline-flex w-fit items-center gap-1 rounded text-caption text-text-secondary transition-colors duration-fast hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {widget.drillLabel ?? 'Open'}
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Link>
          )}
        </div>
      )}
    </DashboardWidget>
  );
}

/**
 * The headline figure and, when compare is on, how it moved.
 *
 * The value comes before the delta in the DOM deliberately — D-02 on the
 * doctor dashboard is open precisely because a delta chip that precedes its
 * value makes the accessible name read backwards ("2 min down, 24 min"). The
 * comparison also spells out its own direction in text rather than relying on
 * the badge's colour, so the reading survives greyscale and colour-blindness.
 */
function SummaryLine({ summary }: { summary: WidgetSummary }) {
  const comparison = summary.comparison;

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-caption text-text-secondary">{summary.label}</span>
      <span className="text-h3 font-semibold tabular-nums text-text-primary">{summary.value}</span>
      {comparison === null ? null : (
        <Badge
          variant={
            comparison.sentiment === 'good'
              ? 'success'
              : comparison.sentiment === 'bad'
                ? 'error'
                : 'neutral'
          }
          emphasis="outline"
        >
          {comparison.deltaPercent === null
            ? `was ${comparison.previousValue}`
            : `${comparison.deltaPercent > 0 ? '+' : ''}${comparison.deltaPercent.toString()}% vs previous period (was ${comparison.previousValue})`}
        </Badge>
      )}
    </div>
  );
}

/** The chart for a visual. One `switch`, so an unhandled kind is a type error. */
function WidgetChart({ title, visual }: { title: string; visual: WidgetVisual }) {
  switch (visual.kind) {
    case 'line':
    case 'area':
      return (
        <LineAreaChart
          series={visual.series}
          variant={visual.kind === 'area' ? 'area' : 'line'}
          formatValue={(value) => formatValue(visual.format, value)}
          ariaLabel={title}
        />
      );
    case 'bar':
      return (
        <BarChart
          series={visual.series}
          {...(visual.barTones === undefined ? {} : { barTones: visual.barTones })}
          formatValue={(value) => formatValue(visual.format, value)}
          ariaLabel={title}
        />
      );
    case 'distribution':
      return (
        <DistributionBars
          series={visual.series}
          formatValue={(value) => formatValue(visual.format, value)}
          ariaLabel={title}
        />
      );
    case 'pie':
      return (
        <PieChart
          slices={visual.slices}
          formatValue={(value) => formatValue(visual.format, value)}
          ariaLabel={title}
        />
      );
    case 'heatmap':
      return (
        <Heatmap
          data={visual.data}
          formatValue={(value) =>
            // The sentinel is "this month has not happened", not zero. Saying
            // so in the tooltip is the difference between a blank cell that
            // reads as missing data and one that reads as total churn.
            value === visual.blankValue ? 'No data yet' : formatValue(visual.format, value)
          }
          ariaLabel={title}
        />
      );
    case 'facts':
      return (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {visual.facts.map((fact) => (
            <div key={fact.label} className="flex flex-col gap-1">
              <dt className="text-caption text-text-secondary">{fact.label}</dt>
              <dd className="text-h4 font-semibold tabular-nums text-text-primary">{fact.value}</dd>
              {fact.hint === null ? null : (
                <p className="text-caption text-text-tertiary">{fact.hint}</p>
              )}
            </div>
          ))}
        </dl>
      );
  }
}

interface TableRow {
  readonly id: string;
  readonly cells: readonly (string | number)[];
}

/**
 * The dataset as a table.
 *
 * Columns are built from the dataset's own headers rather than declared here,
 * so a widget that grows an annotation column grows a table column with it and
 * nobody has to remember to add one.
 */
function WidgetTable({ title, dataset }: { title: string; dataset: WidgetDataset }) {
  const rows: readonly TableRow[] = dataset.rows.map((cells, index) => ({
    id: `${index.toString()}:${String(cells[0] ?? '')}`,
    cells,
  }));

  return (
    <DataTable
      bare
      density="dense"
      caption={`${title}, as a table`}
      getRowId={(row) => row.id}
      rows={rows}
      columns={dataset.columns.map((column, index) => ({
        id: column,
        header: column,
        // The first column is the category; everything after it is a figure,
        // and figures sit right-aligned and tabular so a reader can scan a
        // column of them without the digits dancing.
        align: index === 0 ? ('left' as const) : ('right' as const),
        cell: (row: TableRow) => (
          <span className={index === 0 ? undefined : 'tabular-nums'}>
            {String(row.cells[index] ?? '—')}
          </span>
        ),
      }))}
    />
  );
}
