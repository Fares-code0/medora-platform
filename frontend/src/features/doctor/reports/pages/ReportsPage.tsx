import { useMemo, useState } from 'react';

import { ChartColumnBig, Download } from 'lucide-react';

import { ErrorState } from '@/components/feedback';
import { ContentHeader, Grid, PageContainer, PageSections } from '@/components/layout';
import { Button } from '@/components/ui';

import {
  useAnalyticsQuery,
  useReportsDocumentQuery,
  useTouchSavedReportMutation,
} from '../api/useReportsQueries';
import { AnalyticsGrid } from '../components/AnalyticsGrid';
import { ExportDialog } from '../components/ExportDialog';
import { KpiRow } from '../components/KpiRow';
import { ReportsFilterBar } from '../components/ReportsFilterBar';
import { ReportsFiltersDrawer } from '../components/ReportsFiltersDrawer';
import { SavedReportsRail } from '../components/SavedReportsRail';
import { ScheduledReportsPanel } from '../components/ScheduledReportsPanel';
import { useReportFilters } from '../hooks/useReportFilters';
import { CATEGORY_VIEW, type ReportFilters, type SavedReport } from '../model/types';
import { reportsService } from '../service';

/**
 * Reports & Analytics Center (/doctor/reports) — a Power BI / Looker-style
 * executive dashboard: sticky category + date filters, a KPI band, a
 * chart-first analytics grid with an AI insights panel, and the saved /
 * scheduled report rails. All state is URL-owned so any view is shareable.
 */

function chipLabel(key: string, value: string): string {
  const prefix: Record<string, string> = {
    department: 'Dept',
    status: 'Status',
    medication: 'Medication',
    labTest: 'Lab test',
    age: 'Age',
    gender: 'Gender',
  };
  return `${prefix[key] ?? key}: ${value}`;
}

const CHIP_KEYS: readonly (keyof ReportFilters)[] = [
  'department',
  'status',
  'medication',
  'labTest',
  'age',
  'gender',
];

export function ReportsPage() {
  const {
    filters,
    setCategory,
    setRange,
    setCustomRange,
    setFilter,
    clearAdvanced,
    applyFilters,
    activeAdvancedCount,
  } = useReportFilters();

  const analytics = useAnalyticsQuery(filters);
  const documentQuery = useReportsDocumentQuery();
  const touchReport = useTouchSavedReportMutation();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const activeChips = useMemo(
    () =>
      CHIP_KEYS.filter(
        (key) =>
          filters[key] !== 'all' &&
          // A chip only for a filter the source applies (`capabilities`).
          (reportsService.capabilities.advancedFilters as readonly string[]).includes(key),
      ).map((key) => ({
        key,
        label: chipLabel(key, String(filters[key])),
        onRemove: () => setFilter(key, 'all'),
      })),
    [filters, setFilter],
  );

  const applySaved = (report: SavedReport) => {
    applyFilters(report.filters);
    touchReport.mutate(report.id);
  };

  // Focus the KPI band on the selected category (empty = hidden).
  const view = CATEGORY_VIEW[filters.category];
  const allKpis = analytics.data?.snapshot.kpis ?? [];
  const focusedKpis =
    view.kpiIds.length === 0 ? [] : allKpis.filter((kpi) => view.kpiIds.includes(kpi.id));

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Reports & Analytics"
          caption="Executive dashboards across your practice — revenue, patients, labs, and more."
          icon={ChartColumnBig}
          tone="primary"
          actions={
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={Download}
              onClick={() => setExportOpen(true)}
            >
              Export
            </Button>
          }
        />

        <ReportsFilterBar
          filters={filters}
          onCategory={setCategory}
          onRange={setRange}
          onOpenFilters={() => setFiltersOpen(true)}
          advancedCount={activeAdvancedCount}
          activeChips={activeChips}
          onClear={clearAdvanced}
        />

        {view.kpiIds.length > 0 ? (
          <KpiRow kpis={focusedKpis} loading={analytics.isPending} />
        ) : null}

        {analytics.isError || (!analytics.isPending && !analytics.data) ? (
          <ErrorState
            title="Couldn't load analytics"
            description="Something went wrong building this report. Please try again."
            onRetry={() => void analytics.refetch()}
          />
        ) : analytics.data ? (
          <AnalyticsGrid
            snapshot={analytics.data.snapshot}
            insights={analytics.data.insights}
            revenueAlternate={analytics.data.revenueAlternate}
            category={filters.category}
            onExport={() => setExportOpen(true)}
          />
        ) : (
          <AnalyticsGridSkeleton />
        )}

        <Grid columns={{ base: 1, lg: 2 }} gap={4}>
          <SavedReportsRail
            saved={documentQuery.data?.saved ?? []}
            currentFilters={filters}
            onApply={applySaved}
          />
          <ScheduledReportsPanel scheduled={documentQuery.data?.scheduled ?? []} />
        </Grid>
      </PageSections>

      <ReportsFiltersDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onFilter={setFilter}
        onCustomRange={setCustomRange}
        onClear={clearAdvanced}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        snapshot={analytics.data?.snapshot}
      />
    </PageContainer>
  );
}

function AnalyticsGridSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-72 animate-pulse rounded-surface border border-border bg-surface-sunken lg:col-span-2" />
        <div className="h-72 animate-pulse rounded-surface border border-border bg-surface-sunken" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-64 animate-pulse rounded-surface border border-border bg-surface-sunken"
          />
        ))}
      </div>
    </div>
  );
}
