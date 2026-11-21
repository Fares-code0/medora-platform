import type { ReactNode } from 'react';

import { Download } from 'lucide-react';

import { BarChart, DistributionBars, Heatmap, LineAreaChart, PieChart } from '@/components/charts';
import { Grid } from '@/components/layout';
import { DashboardWidget } from '@/components/patterns';
import type { MenuEntry } from '@/components/ui';
import { isolateLtr } from '@/i18n';

import type { RevenueAlternate } from '../model/reports-service';
import { formatCurrency, formatNumber } from '../model/selectors';
import {
  CATEGORY_VIEW,
  REPORT_CATEGORIES,
  type AnalyticsSnapshot,
  type Insight,
  type ReportCategory,
} from '../model/types';
import { reportsService } from '../service';

import { InsightsPanel } from './InsightsPanel';

/**
 * Analytics grid — the dashboard body, driven by the active category
 * (CATEGORY_VIEW). Selecting a category focuses the page on ONLY that
 * domain's charts (no unrelated sections); Overview is the single
 * cross-practice summary. Chart-first with minimal tables — Power BI /
 * Looker, not another list page.
 */

const AREA_CATEGORIES: readonly ReportCategory[] = [
  'overview',
  'revenue',
  'patients',
  'appointments',
  'records',
];

/** A chart's card: plain, with no coloured card edge (Medora uses none, by design). */
interface ChartCard {
  readonly title: string;
  readonly subtitle: string;
  readonly node: ReactNode;
}

function restColumns(count: number): 2 | 3 {
  return count >= 3 ? 3 : 2;
}

const CATEGORY_SUBTITLE: Record<ReportCategory, string> = {
  overview: 'A cross-practice executive summary.',
  revenue: 'Income trends and where it comes from.',
  patients: 'Volume, mix, and demographics.',
  appointments: 'Scheduling volume and busy periods.',
  laboratory: 'Order status, turnaround, and criticals.',
  records: 'Documentation volume by type.',
  pharmacy: 'Prescribing patterns by drug class.',
  messages: 'Communication volume and cadence.',
  ai: 'AI assistant adoption by feature.',
};

export interface AnalyticsGridProps {
  snapshot: AnalyticsSnapshot;
  insights: readonly Insight[];
  /** The server's stand-in for revenue when billing is off; see `AnalyticsResult`. */
  revenueAlternate?: RevenueAlternate | null;
  category: ReportCategory;
  onExport: () => void;
}

export function AnalyticsGrid({
  snapshot,
  insights,
  revenueAlternate = null,
  category,
  onExport,
}: AnalyticsGridProps) {
  const exportMenu: readonly MenuEntry[] = [
    { id: 'export', label: 'Export this view', icon: Download, onSelect: onExport },
  ];

  const view = CATEGORY_VIEW[category];
  const trendVariant = AREA_CATEGORIES.includes(category) ? 'area' : 'line';

  // Focus the trend on the category's own metric(s) when specified.
  const trendSeries = view.trendSeries
    ? snapshot.trend.filter((series) => view.trendSeries?.includes(series.name))
    : snapshot.trend;

  // Focus the insights on the category's own kinds; empty = no panel.
  const shownInsights = view.insightKinds
    ? insights.filter((insight) => view.insightKinds?.includes(insight.kind))
    : insights;
  const showInsights = view.insightKinds === null || view.insightKinds.length > 0;

  const catalog: Record<string, ChartCard> = {
    trend: {
      title: view.trendSeries
        ? `${view.trendSeries[0] ?? 'Performance'} trend`
        : 'Performance trend',
      // Named from the series present, so a source without revenue does not
      // promise one.
      subtitle: view.trendSeries
        ? 'Over the selected period'
        : trendSeries.map((series) => series.name.replace(/ \(k\)$/, '')).join(' · '),
      node: (
        <LineAreaChart
          series={trendSeries}
          variant={trendVariant}
          ariaLabel="Trend over the selected period"
        />
      ),
    },
    departments: {
      title: 'Patients by department',
      subtitle: 'Share of active patients',
      node: (
        <PieChart
          slices={snapshot.departments}
          variant="donut"
          centerLabel="Patients"
          formatValue={formatNumber}
          ariaLabel="Patients by department"
        />
      ),
    },
    labStatus: {
      title: 'Lab orders by status',
      subtitle: 'Turnaround & criticals',
      node: (
        <PieChart
          slices={snapshot.labStatus}
          variant="donut"
          centerLabel="Orders"
          formatValue={formatNumber}
          ariaLabel="Lab orders by status"
        />
      ),
    },
    weekday: {
      title: 'Appointments by weekday',
      subtitle: 'Volume distribution',
      node: (
        <BarChart
          series={snapshot.weekday}
          formatValue={formatNumber}
          ariaLabel="Appointments by weekday"
        />
      ),
    },
    pharmacy: {
      title: 'Prescriptions by drug class',
      subtitle: 'Top therapeutic areas',
      node: (
        <BarChart
          series={snapshot.pharmacy}
          formatValue={formatNumber}
          ariaLabel="Prescriptions by drug class"
        />
      ),
    },
    age: {
      title: 'Patient age distribution',
      subtitle: 'Across the practice',
      node: (
        <DistributionBars
          // Age bands are Latin-only and "65+" ends in a sign; isolated here,
          // not in the shared chart, whose labels may be words (NEW-32).
          series={{
            ...snapshot.ageDistribution,
            points: snapshot.ageDistribution.points.map((point) => ({
              ...point,
              label: isolateLtr(point.label),
            })),
          }}
          formatValue={formatNumber}
          ariaLabel="Patient age distribution"
        />
      ),
    },
    records: {
      title: 'Records by type',
      subtitle: 'Documentation volume',
      node: (
        <BarChart
          series={snapshot.records}
          formatValue={formatNumber}
          ariaLabel="Records by type"
        />
      ),
    },
    messages: {
      title: 'Messages by weekday',
      subtitle: 'Communication cadence',
      node: (
        <BarChart
          series={snapshot.messages}
          formatValue={formatNumber}
          ariaLabel="Messages by weekday"
        />
      ),
    },
    ai: {
      title: 'AI usage by feature',
      subtitle: 'Assistant adoption',
      node: (
        <DistributionBars
          series={snapshot.aiUsage}
          formatValue={formatNumber}
          ariaLabel="AI usage by feature"
        />
      ),
    },
    heatmap: {
      title: 'Activity heatmap',
      subtitle: 'Intensity by weekday and time of day',
      node: (
        <Heatmap data={snapshot.heatmap} formatValue={formatNumber} ariaLabel="Activity heatmap" />
      ),
    },
  };

  if (category === 'revenue' && revenueAlternate) {
    return (
      <RevenueAlternateView alternate={revenueAlternate} insights={insights} onExport={onExport} />
    );
  }

  const ids = view.charts;
  const featuredId = ids[0] ?? 'trend';
  const featured = catalog[featuredId];
  const rest = ids.slice(1).filter((id) => id !== 'heatmap');
  const showHeatmap = ids.includes('heatmap');
  const meta = REPORT_CATEGORIES.find((c) => c.id === category);

  const widget = (id: string, card: ChartCard, className?: string) => (
    <DashboardWidget
      key={id}
      title={card.title}
      subtitle={card.subtitle}
      menu={exportMenu}
      {...(className ? { className } : {})}
    >
      {card.node}
    </DashboardWidget>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Category heading */}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-h5 font-semibold text-text-primary">{meta?.label ?? 'Analytics'}</h2>
        <p className="text-caption text-text-tertiary">{CATEGORY_SUBTITLE[category]}</p>
      </div>

      {/* Featured chart + (optional) insights */}
      {showInsights ? (
        <Grid columns={{ base: 1, lg: 3 }} gap={4}>
          {featured ? widget(featuredId, featured, 'lg:col-span-2') : null}
          <InsightsPanel insights={shownInsights} />
        </Grid>
      ) : featured ? (
        widget(featuredId, featured)
      ) : null}

      {/* Supporting charts */}
      {rest.length > 0 ? (
        <Grid columns={{ base: 1, lg: restColumns(rest.length) }} gap={4}>
          {rest.map((id) => {
            const card = catalog[id];
            return card ? widget(id, card) : null;
          })}
        </Grid>
      ) : null}

      {/* Heatmap (full width) */}
      {showHeatmap && catalog['heatmap'] ? widget('heatmap', catalog['heatmap']) : null}

      {reportsService.capabilities.illustrative ? (
        <p className="text-caption text-text-secondary">
          Revenue shown in thousands. Figures are illustrative demo analytics ·{' '}
          {formatCurrency(snapshot.kpis.find((k) => k.id === 'revenue')?.value ?? 0)} total this
          period.
        </p>
      ) : (
        <p className="text-caption text-text-secondary">
          Computed by the Medora server from your own patients and appointments. Days are the
          server&apos;s (UTC).
        </p>
      )}
    </div>
  );
}

/**
 * The revenue category without billing (ADR-037 §3): the server's notice,
 * verbatim, and the doctor's most frequent visit types in the slot the
 * revenue chart would have used — never a revenue chart of zeros.
 */
function RevenueAlternateView({
  alternate,
  insights,
  onExport,
}: {
  alternate: RevenueAlternate;
  insights: readonly Insight[];
  onExport: () => void;
}) {
  const revenueInsights = insights.filter((insight) => insight.kind === 'revenue');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-h5 font-semibold text-text-primary">Revenue</h2>
        <p className="text-caption text-text-tertiary">Billing is not enabled</p>
      </div>
      <Grid columns={{ base: 1, lg: revenueInsights.length > 0 ? 3 : 1 }} gap={4}>
        <DashboardWidget
          title="Top visit types"
          subtitle={alternate.notice}
          menu={[{ id: 'export', label: 'Export this view', icon: Download, onSelect: onExport }]}
          className={revenueInsights.length > 0 ? 'lg:col-span-2' : undefined}
          empty={
            alternate.topVisitTypes.length === 0 ? (
              <p className="text-body-sm text-text-secondary">No visits in this period.</p>
            ) : undefined
          }
        >
          <BarChart
            series={{ name: 'Visits', tone: 'chart1', points: alternate.topVisitTypes }}
            formatValue={formatNumber}
            ariaLabel="Your most frequent visit types in this period"
          />
        </DashboardWidget>
        {revenueInsights.length > 0 ? <InsightsPanel insights={revenueInsights} /> : null}
      </Grid>
    </div>
  );
}
