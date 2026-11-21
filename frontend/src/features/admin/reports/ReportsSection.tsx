import { useState } from 'react';

import { Download } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { useAuth, useCan, useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import { Button, Select, Switch, Tabs } from '@/components/ui';

import { SectionShell } from '../components/SectionShell';

import {
  useReportDocument,
  useReportMutations,
  useScheduledReports,
} from './api/useReportsQueries';
import { RANGE_LABEL, REPORT_CAPTION, REPORT_LABEL, isRangeKey, isReportId } from './reports';
import type {
  RangeKey,
  ReportId,
  ScheduleDraft,
  ScheduledReport,
  WidgetDataset,
} from './reports.types';
import { RANGE_KEYS, REPORT_IDS } from './reports.types';
import { ReportWidgetCard } from './ReportWidgetCard';
import { ScheduledReportsPanel } from './ScheduledReportsPanel';
import { ScheduleReportDialog } from './ScheduleReportDialog';

/**
 * Admin Reports (ADM-08 · UX §3.8) — four report tabs over one range.
 *
 * ## Everything here is derived
 *
 * There is no reports store. Each tab is computed from the ADM-02 / ADM-04 /
 * ADM-05 / ADM-07 documents on every read, so the no-show rate on this page
 * and the no-show rows on appointment oversight are the same appointments
 * counted once — the property ADM-01 established and the reason its KPIs can
 * never disagree with the pages they link to. Where a §3.8 widget has no
 * source in this client at all, it says so and names the service that would
 * supply it, rather than rendering an invented series (see `reports.ts`).
 *
 * ## The URL seeds the view; it does not own it
 *
 * `?report=`, `?range=` and `?compare=` are read once, exactly as ADM-05 reads
 * `?doctor=` and ADM-07 reads `?type=`. That keeps a link from a briefing or a
 * saved bookmark landing on the right tab, while leaving the controls
 * authoritative the moment an administrator touches them — the alternative,
 * writing every toggle back to the URL, makes the browser's Back button undo a
 * range change, which on a page of four tabs is a trap rather than a feature.
 *
 * ## Why viewing is not capability-gated and exporting is
 *
 * The route is already administrator-only. §3.8 names no capability, and the
 * page shows aggregates with no patient identifier anywhere on it — nothing
 * here goes through ADM-10 because nothing here is an identifier. Taking the
 * numbers *out* of the platform is a different act: it writes a `data-export`
 * row to the audit trail and produces a file that outlives the session, which
 * is precisely what `logs.export` governs on ADM-07. So the two export paths
 * are gated and the reading is not.
 */

const DEFAULT_REPORT: ReportId = 'growth';
const DEFAULT_RANGE: RangeKey = '30d';

export function ReportsSection() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const can = useCan();
  const { toast } = useToast();

  const [reportId, setReportId] = useState<ReportId>(() => {
    const requested = searchParams.get('report');
    return requested !== null && isReportId(requested) ? requested : DEFAULT_REPORT;
  });
  const [range, setRange] = useState<RangeKey>(() => {
    const requested = searchParams.get('range');
    return requested !== null && isRangeKey(requested) ? requested : DEFAULT_RANGE;
  });
  const [compare, setCompare] = useState(() => searchParams.get('compare') === '1');

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [busyScheduleId, setBusyScheduleId] = useState<string | null>(null);

  const document = useReportDocument(reportId, range, compare);
  const schedules = useScheduledReports();
  const { createSchedule, setPaused, deleteSchedule, exportWidget, exportDeck } =
    useReportMutations();

  const actor = user?.name ?? 'Administrator';
  const canExport = can('logs.export');

  const widgets = document.data?.widgets ?? [];
  const notes = document.data?.notes ?? [];

  /**
   * The widget's own dataset, handed straight through. `ReportWidgetCard`
   * passes what it just rendered, so the file and the table are the same rows
   * rather than two builds of the same query.
   */
  const handleWidgetExport = (title: string, dataset: WidgetDataset) => {
    exportWidget.mutate(
      { reportId, range, title, dataset, actor },
      {
        onSuccess: (rows) => {
          toast({
            variant: 'success',
            title: `Exported ${title}`,
            description: `${rows.toString()} rows. The export is recorded in system logs.`,
          });
        },
        onError: () => {
          toast({ variant: 'error', title: `Couldn't export ${title}` });
        },
      },
    );
  };

  const handleDeckExport = () => {
    exportDeck.mutate(
      { reportId, range, compare, actor },
      {
        onSuccess: (count) => {
          toast({
            variant: 'success',
            title: `Exported the ${REPORT_LABEL[reportId]} report`,
            description: `${count.toString()} widgets. The export is recorded in system logs.`,
          });
        },
        onError: () => {
          toast({ variant: 'error', title: 'Couldn’t export the report' });
        },
      },
    );
  };

  const handleCreateSchedule = (draft: ScheduleDraft) => {
    createSchedule.mutate(
      { draft, actor },
      {
        onSuccess: () => {
          setScheduleOpen(false);
          toast({
            variant: 'success',
            title: 'Schedule created',
            description: `${draft.name} will be built ${draft.frequency}.`,
          });
        },
        onError: () => {
          toast({ variant: 'error', title: 'Couldn’t create the schedule' });
        },
      },
    );
  };

  const handleTogglePause = (schedule: ScheduledReport) => {
    setBusyScheduleId(schedule.id);
    setPaused.mutate(
      { id: schedule.id, paused: !schedule.paused },
      {
        onSettled: () => {
          setBusyScheduleId(null);
        },
      },
    );
  };

  const handleDelete = (schedule: ScheduledReport) => {
    setBusyScheduleId(schedule.id);
    deleteSchedule.mutate(schedule.id, {
      onSettled: () => {
        setBusyScheduleId(null);
      },
      onSuccess: () => {
        toast({ variant: 'success', title: `Deleted ${schedule.name}` });
      },
    });
  };

  return (
    <SectionShell
      slug="reports"
      actions={
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={Download}
          onClick={handleDeckExport}
          loading={exportDeck.isPending}
          disabled={!canExport || document.data === undefined}
        >
          Export deck
        </Button>
      }
      toolbar={
        <>
          <Tabs
            aria-label="Report"
            variant="enclosed"
            value={reportId}
            onValueChange={(value) => {
              if (isReportId(value)) setReportId(value);
            }}
            items={REPORT_IDS.map((id) => ({ value: id, label: REPORT_LABEL[id] }))}
            className="sm:flex-1"
          />
          <Select
            aria-label="Reporting range"
            value={range}
            onChange={(value) => {
              if (isRangeKey(value)) setRange(value);
            }}
            options={RANGE_KEYS.map((key) => ({ value: key, label: RANGE_LABEL[key] }))}
            containerClassName="sm:w-48"
          />
          <Switch
            checked={compare}
            onCheckedChange={setCompare}
            aria-label="Compare with the previous period"
            label="Compare"
          />
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="text-caption text-text-secondary">{REPORT_CAPTION[reportId]}</p>

        <Grid columns={{ base: 1, lg: 2 }} gap={4}>
          {widgets.map((widget) => (
            <ReportWidgetCard
              key={widget.id}
              widget={widget}
              // One query serves the whole tab, so a widget is loading exactly
              // when the tab is. Per-widget retry (§3.8) still routes through
              // the same refetch — there is one request behind all of them, and
              // pretending otherwise would give the reader a Retry that could
              // fix one card and leave its neighbour broken.
              loading={document.isPending}
              error={document.isError}
              onRetry={() => void document.refetch()}
              onExport={handleWidgetExport}
              className={
                // Heatmaps and cohort grids need the width; a two-up column
                // squeezes seven weekday columns into something unreadable.
                widget.visual?.kind === 'heatmap' ? 'lg:col-span-2' : undefined
              }
            />
          ))}
        </Grid>

        {notes.length === 0 ? null : (
          <ul className="flex flex-col gap-1">
            {notes.map((note) => (
              <li key={note} className="text-caption text-text-tertiary">
                {note}
              </li>
            ))}
          </ul>
        )}

        {!canExport ? (
          <p className="text-caption text-text-tertiary">
            Exporting a report needs the Export logs capability, because it writes to the audit
            trail.
          </p>
        ) : null}

        <ScheduledReportsPanel
          schedules={schedules.data ?? []}
          loading={schedules.isPending}
          busyId={busyScheduleId}
          onCreate={() => {
            setScheduleOpen(true);
          }}
          onTogglePause={handleTogglePause}
          onDelete={handleDelete}
        />
      </div>

      {/*
       * Mounted only while open and keyed on the tab and range it was opened
       * from, so the dialog's pre-filled report, range and name come from what
       * the administrator is actually looking at rather than from whatever they
       * were looking at the first time they opened it.
       */}
      {scheduleOpen ? (
        <ScheduleReportDialog
          key={`${reportId}:${range}`}
          open
          onClose={() => {
            setScheduleOpen(false);
          }}
          reportId={reportId}
          range={range}
          onSubmit={handleCreateSchedule}
          submitting={createSchedule.isPending}
        />
      ) : null}
    </SectionShell>
  );
}
