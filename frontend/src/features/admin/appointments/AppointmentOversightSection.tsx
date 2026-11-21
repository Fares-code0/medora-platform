import { useMemo, useState } from 'react';

import {
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  BellRing,
  CalendarCheck,
  CalendarRange,
  Eye,
  MoreHorizontal,
  TimerReset,
  UserRoundX,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { useAuth, useCan, useToast } from '@/app/providers';
import { ExportButton, StatisticCard, StatusBadge } from '@/components/patterns';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  type DataTableColumn,
  Dropdown,
  type MenuEntry,
  SearchInput,
  Select,
} from '@/components/ui';
import type { ExportDataset } from '@/utils/export';

import { AsyncSection, GridEmpty, Panel } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';
import { adminRefusal } from '../refusal';

import {
  useOversightDocument,
  useOversightMutations,
  useOversightSummary,
} from './api/useOversightQueries';
import { AppointmentDetailDrawer } from './AppointmentDetailDrawer';
import { CancelDialog } from './CancelDialog';
import { NudgeDialog } from './NudgeDialog';
import {
  ageInStateMs,
  availableActions,
  canNudge,
  DATE_RANGE_LABEL,
  EMPTY_FILTERS,
  FLAG_LABEL,
  FLAG_VARIANT,
  filterAppointments,
  flagsFor,
  formatAge,
  formatSlot,
  isTerminal,
  STATUS_LABEL,
  STATUS_KIND,
  STUCK_PENDING_HOURS,
} from './oversight';
import type {
  CancelCategory,
  DateRangeKey,
  OversightAppointment,
  OversightFilters,
  OversightFlag,
  OversightStatus,
  OversightSummary,
} from './oversight.types';
import { PatientIdentity } from './PatientIdentity';
import { ReassignDialog } from './ReassignDialog';
import { UtilizationHeatmap } from './UtilizationHeatmap';

/**
 * Appointment oversight (ADM-05 · UX §3.5) — the platform's scheduling
 * health in one table, and the three interventions that go with it.
 *
 * Three decisions worth knowing about:
 *
 * - **Age-in-state is the point of the page.** Not the booking date: how
 *   long a request has sat where it is. Everything else — the KPI strip,
 *   the flags, the nudge — hangs off that column.
 * - **Patient identifiers stay masked** (ADM-10). Oversight is about doctors
 *   and slots; an administrator who genuinely needs the name can justify it
 *   per row, and that reveal is logged.
 * - **Bulk applies to nudges only.** §3.5 rules out destructive bulk actions,
 *   so selection drives the reminder button and nothing else. Reassign and
 *   cancel are per-row, each behind its own capability.
 */

/**
 * The statuses the toolbar filters on — and so the only ones `?status=` may
 * seed. Named rather than inlined into the options below so the filter and
 * the URL seeding read the same list: a status the picker offers but the seed
 * rejects is a drill-down that silently lands unfiltered.
 */
const OVERSIGHT_STATUSES = [
  'pending',
  'scheduled',
  'confirmed',
  'rescheduled',
  'completed',
  'cancelled',
  'no-show',
  'awaiting-patient',
] as const;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...OVERSIGHT_STATUSES.map((status) => ({ value: status, label: STATUS_LABEL[status] })),
];

/** The flags the toolbar filters on — and so the only ones `?flag=` may seed. */
const OVERSIGHT_FLAGS = ['stuck-pending', 'repeated-reschedules', 'complaint-attached'] as const;

const FLAG_OPTIONS = [
  { value: 'all', label: 'All rows' },
  ...OVERSIGHT_FLAGS.map((flag) => ({ value: flag, label: FLAG_LABEL[flag] })),
];

const RANGE_OPTIONS = (['today', '7d', '30d', 'all'] as const).map((range) => ({
  value: range,
  label: DATE_RANGE_LABEL[range],
}));

export function AppointmentOversightSection() {
  const document = useOversightDocument();
  const summaryQuery = useOversightSummary();
  const { nudge, reassign, cancel } = useOversightMutations();
  const { user } = useAuth();
  const can = useCan();
  const { toast } = useToast();

  /**
   * `?doctor=<id>` narrows the table on arrival, so "reassign their
   * appointments first" from a suspension (ADM-02) lands on that doctor's
   * rows rather than on all of them. `?flag=` does the same for the ADM-01
   * action queue, and `?status=` for ADM-08's drill-downs — §3.8 requires a
   * no-show bar to land on §3.5 already filtered, and without this it landed
   * on every appointment instead. Read once, as the initial filter: the URL
   * seeds the view, it does not own it, so the toolbar stays authoritative
   * the moment the administrator touches it.
   *
   * Every seed widens the range to every date. The KPI the queue counts is
   * range-free, so leaving the default 7-day window on would land an
   * administrator on fewer rows than the number they just clicked.
   *
   * Each value is matched against its own union rather than cast, so a stale
   * or hand-typed parameter is ignored instead of becoming a filter no row
   * can satisfy — the same rule ADM-07's `filtersFromSearch` follows.
   */
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<OversightFilters>(() => {
    const doctorId = searchParams.get('doctor');
    const requestedFlag = searchParams.get('flag');
    const requestedStatus = searchParams.get('status');
    const flag = OVERSIGHT_FLAGS.find((entry) => entry === requestedFlag);
    const status = OVERSIGHT_STATUSES.find((entry) => entry === requestedStatus);

    let seeded = EMPTY_FILTERS;
    if (flag !== undefined) seeded = { ...seeded, flag, range: 'all' };
    if (status !== undefined) seeded = { ...seeded, status, range: 'all' };
    return doctorId === null ? seeded : { ...seeded, doctorId, range: 'all' };
  });
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<OversightAppointment | null>(null);
  const [nudging, setNudging] = useState<readonly OversightAppointment[] | null>(null);
  const [reassigning, setReassigning] = useState<OversightAppointment | null>(null);
  const [cancelling, setCancelling] = useState<OversightAppointment | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const actor = user?.name ?? 'Administrator';
  const permissions = {
    canReassign: can('appointments.reassign'),
    canCancel: can('appointments.cancelAdministratively'),
  };

  const appointments = useMemo(() => document.data?.appointments ?? [], [document.data]);
  const doctors = useMemo(() => document.data?.doctors ?? [], [document.data]);

  // One clock per render, shared by every derived value — otherwise the KPI
  // strip and the table can disagree about what "24 hours" means.
  const now = Date.now();
  // The KPI strip is the service's answer — the server's own counts in a
  // live build — so it cannot drift from what the API reports elsewhere.
  const summary = summaryQuery.data;
  const rows = useMemo(
    () => filterAppointments(appointments, filters, now),
    [appointments, filters, now],
  );

  const doctorOptions = useMemo(
    () => [
      { value: 'all', label: 'All doctors' },
      ...doctors.map((doctor) => ({ value: doctor.id, label: doctor.name })),
    ],
    [doctors],
  );

  const departmentOptions = useMemo(() => {
    const names = [...new Set(appointments.map((a) => a.department))].sort();
    return [
      { value: 'all', label: 'All departments' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [appointments]);

  /* ── Selection (nudges only) ────────────────────────────────── */

  const nudgeableRows = rows.filter((row) => canNudge(row, now));
  const selectedRows = rows.filter((row) => selected.includes(row.id) && canNudge(row, now));
  const allNudgeableSelected =
    nudgeableRows.length > 0 && nudgeableRows.every((row) => selected.includes(row.id));

  const toggleRow = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const toggleAll = () => {
    setSelected(allNudgeableSelected ? [] : nudgeableRows.map((row) => row.id));
  };

  /* ── Interventions ──────────────────────────────────────────── */

  const failureMessage = adminRefusal;

  const runNudge = (message: string) => {
    const targets = nudging ?? [];
    setActionError(null);
    nudge.mutate(
      { ids: targets.map((entry) => entry.id), actor, message },
      {
        onSuccess: () => {
          setNudging(null);
          setSelected([]);
          toast({
            variant: 'success',
            title:
              targets.length === 1
                ? `Reminder sent for ${targets[0]?.reference ?? 'the request'}`
                : `${String(targets.length)} reminders sent`,
            description: 'Recorded on each appointment history.',
          });
        },
        onError: (error) => setActionError(failureMessage(error)),
      },
    );
  };

  const runReassign = (doctorId: string, reason: string) => {
    const appointment = reassigning;
    if (appointment === null) return;
    setActionError(null);
    reassign.mutate(
      { id: appointment.id, toDoctorId: doctorId, actor, reason },
      {
        onSuccess: () => {
          const receiving = doctors.find((entry) => entry.id === doctorId);
          setReassigning(null);
          toast({
            variant: 'success',
            title: `${appointment.reference} reassigned`,
            description: `Now with ${receiving?.name ?? 'the receiving doctor'}. Patient and both doctors notified.`,
          });
        },
        onError: (error) => {
          // §3.5: a failed reassign changes nothing and notifies no one. The
          // dialog stays open holding the reason, so the attempt is not lost.
          const message = failureMessage(error);
          setActionError(message);
          toast({ variant: 'error', title: 'Reassignment failed', description: message });
        },
      },
    );
  };

  const runCancel = (category: CancelCategory, reason: string) => {
    const appointment = cancelling;
    if (appointment === null) return;
    setActionError(null);
    cancel.mutate(
      { id: appointment.id, category, actor, reason },
      {
        onSuccess: () => {
          setCancelling(null);
          toast({
            variant: 'success',
            title: `${appointment.reference} cancelled`,
            description: 'The patient has been notified with the apology template.',
          });
        },
        onError: (error) => setActionError(failureMessage(error)),
      },
    );
  };

  /* ── Export ─────────────────────────────────────────────────── */

  /**
   * Identifiers are not in the export. A CSV is the one artefact that leaves
   * the audited surface entirely, so it carries the reference and the
   * scheduling facts — everything ADM-10 protects stays behind the reveal.
   */
  const getDataset = (): ExportDataset => ({
    filename: 'medora-appointment-oversight',
    title: 'Appointment oversight',
    columns: [
      'Reference',
      'When',
      'Doctor',
      'Department',
      'Type',
      'Status',
      'Age in state',
      'Flags',
    ],
    rows: rows.map((row) => [
      row.reference,
      formatSlot(row.startsAt),
      row.doctorName,
      row.department,
      row.visitType,
      STATUS_LABEL[row.status],
      isTerminal(row.status) ? '—' : formatAge(ageInStateMs(row, now)),
      flagsFor(row, now)
        .map((flag) => FLAG_LABEL[flag])
        .join(' · '),
    ]),
  });

  /* ── Columns ────────────────────────────────────────────────── */

  const columns: readonly DataTableColumn<OversightAppointment>[] = [
    {
      id: 'select',
      header: '',
      width: '2.5rem',
      cell: (row) =>
        canNudge(row, now) ? (
          <Checkbox
            checked={selected.includes(row.id)}
            onChange={() => toggleRow(row.id)}
            aria-label={`Select ${row.reference} for a reminder`}
          />
        ) : null,
    },
    {
      id: 'when',
      header: 'When',
      cell: (row) => (
        <div>
          <div className="whitespace-nowrap font-medium text-text-primary">
            {formatSlot(row.startsAt)}
          </div>
          <div className="text-caption text-text-primary">{row.reference}</div>
        </div>
      ),
    },
    {
      id: 'doctor',
      header: 'Doctor',
      cell: (row) => (
        <div>
          <div className="whitespace-nowrap text-text-primary">{row.doctorName}</div>
          <div className="text-caption text-text-tertiary">{row.department}</div>
        </div>
      ),
    },
    {
      id: 'patient',
      header: 'Patient',
      cell: (row) => (
        <PatientIdentity
          subjectId={row.id}
          subjectLabel={row.reference}
          kind="name"
          value={row.patientName}
        />
      ),
    },
    {
      id: 'type',
      header: 'Type',
      hideBelowMd: true,
      cell: (row) => row.visitType,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <StatusBadge status={STATUS_KIND[row.status]} label={STATUS_LABEL[row.status]} />
      ),
    },
    {
      id: 'age',
      header: 'Age in state',
      cell: (row) =>
        isTerminal(row.status) ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          <span
            className={
              flagsFor(row, now).includes('stuck-pending')
                ? 'font-semibold tabular-nums text-error'
                : 'tabular-nums'
            }
            dir="ltr"
          >
            {formatAge(ageInStateMs(row, now))}
          </span>
        ),
    },
    {
      id: 'flags',
      header: 'Flags',
      hideBelowMd: true,
      cell: (row) => {
        const flags = flagsFor(row, now);
        if (flags.length === 0) return <span className="text-text-tertiary">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {flags.map((flag) => (
              <Badge key={flag} variant={FLAG_VARIANT[flag]}>
                {FLAG_LABEL[flag]}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      width: '3rem',
      cell: (row) => <RowMenu row={row} />,
    },
  ];

  function RowMenu({ row }: { row: OversightAppointment }) {
    const actions = availableActions(row, permissions, now);
    const entries: MenuEntry[] = [
      { id: 'view', label: 'View detail', icon: Eye, onSelect: () => setDetail(row) },
    ];
    if (actions.includes('nudge')) {
      entries.push({
        id: 'nudge',
        label: 'Nudge doctor',
        icon: BellRing,
        onSelect: () => {
          setActionError(null);
          setNudging([row]);
        },
      });
    }
    if (actions.includes('reassign')) {
      entries.push({
        id: 'reassign',
        label: 'Reassign',
        icon: ArrowRightLeft,
        onSelect: () => {
          setActionError(null);
          setReassigning(row);
        },
      });
    }
    if (actions.includes('cancel')) {
      entries.push(
        { type: 'separator', id: 'sep' },
        {
          id: 'cancel',
          label: 'Cancel administratively',
          icon: Ban,
          destructive: true,
          onSelect: () => {
            setActionError(null);
            setCancelling(row);
          },
        },
      );
    }

    return (
      <Dropdown
        align="end"
        menuLabel={`Actions for ${row.reference}`}
        entries={entries}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={MoreHorizontal}
            aria-label={`Actions for ${row.reference}`}
          />
        }
      />
    );
  }

  return (
    <SectionShell
      slug="appointments"
      actions={
        <>
          <Button
            variant="secondary"
            leadingIcon={BellRing}
            disabled={selectedRows.length === 0}
            onClick={() => {
              setActionError(null);
              setNudging(selectedRows);
            }}
          >
            Nudge selected
            {selectedRows.length > 0 ? ` (${String(selectedRows.length)})` : ''}
          </Button>
          <ExportButton
            getDataset={getDataset}
            disabled={rows.length === 0}
            onExported={() =>
              toast({
                variant: 'success',
                title: 'Export ready',
                description: 'Patient identifiers are excluded from the file.',
              })
            }
          />
        </>
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              onClear={() => setFilters({ ...filters, query: '' })}
              placeholder="Search reference, doctor, department or type"
              aria-label="Search appointments"
            />
          </ToolbarGrow>
          <Select
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={(value) =>
              setFilters({ ...filters, status: value as OversightStatus | 'all' })
            }
            aria-label="Filter by status"
            containerClassName="sm:w-44"
          />
          <Select
            options={doctorOptions}
            value={filters.doctorId}
            onChange={(value) => setFilters({ ...filters, doctorId: value })}
            aria-label="Filter by doctor"
            containerClassName="sm:w-52"
          />
          <Select
            options={departmentOptions}
            value={filters.department}
            onChange={(value) => setFilters({ ...filters, department: value })}
            aria-label="Filter by department"
            containerClassName="sm:w-48"
          />
          <Select
            options={RANGE_OPTIONS}
            value={filters.range}
            onChange={(value) => setFilters({ ...filters, range: value as DateRangeKey })}
            aria-label="Filter by date range"
            containerClassName="sm:w-52"
          />
          <Select
            options={FLAG_OPTIONS}
            value={filters.flag}
            onChange={(value) => setFilters({ ...filters, flag: value as OversightFlag | 'all' })}
            aria-label="Filter by flag"
            containerClassName="sm:w-52"
          />
          <Button
            variant={showHeatmap ? 'primary' : 'secondary'}
            leadingIcon={CalendarRange}
            onClick={() => setShowHeatmap((current) => !current)}
            aria-pressed={showHeatmap}
          >
            Heatmap
          </Button>
        </>
      }
    >
      <AsyncSection
        isLoading={document.isLoading || summaryQuery.isLoading}
        isError={document.isError || summaryQuery.isError}
        error={document.error ?? summaryQuery.error}
        onRetry={() => {
          void document.refetch();
          void summaryQuery.refetch();
        }}
      >
        <div className="flex flex-col gap-4">
          {summary === undefined ? null : <SummaryStrip summary={summary} />}

          {showHeatmap ? <UtilizationHeatmap appointments={rows} /> : null}

          <Panel
            title="Appointments"
            description={`${String(rows.length)} of ${String(appointments.length)} across every doctor`}
            icon={CalendarCheck}
            tone="primary"
            bodyClassName="p-0"
            action={
              nudgeableRows.length > 0 ? (
                <Checkbox
                  checked={allNudgeableSelected}
                  indeterminate={selectedRows.length > 0 && !allNudgeableSelected}
                  onChange={toggleAll}
                  label={`Select all pending (${String(nudgeableRows.length)})`}
                />
              ) : null
            }
          >
            <div className="px-2 pb-2">
              <DataTable
                bare
                zebra={false}
                density="admin"
                stickyHeader={false}
                headerVoice="overline"
                columns={columns}
                rows={rows}
                getRowId={(row) => row.id}
                caption="Appointments across every doctor"
                emptyState={<GridEmpty>No appointments match these filters.</GridEmpty>}
              />
            </div>
          </Panel>

          {summary !== undefined && summary.pendingOverThreshold > 0 ? (
            <p className="flex items-center gap-2 text-caption text-text-secondary">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-error" />
              {summary.pendingOverThreshold} request
              {summary.pendingOverThreshold === 1 ? ' has' : 's have'} been waiting on a doctor for
              more than {STUCK_PENDING_HOURS} hours. Select them to send reminders.
            </p>
          ) : null}
        </div>
      </AsyncSection>

      <AppointmentDetailDrawer
        appointment={detail}
        onClose={() => setDetail(null)}
        canNudgeNow={detail !== null && canNudge(detail, now)}
        onNudge={(appointment) => {
          setDetail(null);
          setActionError(null);
          setNudging([appointment]);
        }}
      />

      <NudgeDialog
        open={nudging !== null}
        appointments={nudging ?? []}
        submitting={nudge.isPending}
        error={actionError}
        onClose={() => {
          setNudging(null);
          setActionError(null);
        }}
        onConfirm={runNudge}
      />

      <ReassignDialog
        open={reassigning !== null}
        appointment={reassigning}
        doctors={doctors}
        submitting={reassign.isPending}
        error={actionError}
        onClose={() => {
          setReassigning(null);
          setActionError(null);
        }}
        onConfirm={runReassign}
      />

      <CancelDialog
        open={cancelling !== null}
        appointment={cancelling}
        submitting={cancel.isPending}
        error={actionError}
        onClose={() => {
          setCancelling(null);
          setActionError(null);
        }}
        onConfirm={runCancel}
      />
    </SectionShell>
  );
}

/** The four headline numbers above the table. */
function SummaryStrip({ summary }: { summary: OversightSummary }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatisticCard
        layout="stacked"
        size="lg"
        labelVoice="overline"
        label="Today"
        value={summary.todayTotal}
        icon={CalendarCheck}
        tone="primary"
        hint="Appointments scheduled for today"
      />
      <StatisticCard
        layout="stacked"
        size="lg"
        labelVoice="overline"
        label={`Pending > ${String(STUCK_PENDING_HOURS)}h`}
        value={summary.pendingOverThreshold}
        icon={TimerReset}
        tone={summary.pendingOverThreshold > 0 ? 'error' : 'success'}
        hint="Requests a doctor has not answered"
      />
      <StatisticCard
        layout="stacked"
        size="lg"
        labelVoice="overline"
        label="Cancellation 7d"
        value={summary.window7dTotal === 0 ? '—' : summary.cancellationRate7d}
        unit={summary.window7dTotal === 0 ? undefined : '%'}
        icon={Ban}
        tone="warning"
        hint={
          summary.window7dTotal === 0
            ? 'No appointments in the last 7 days'
            : `of ${String(summary.window7dTotal)} in the last 7 days`
        }
      />
      <StatisticCard
        layout="stacked"
        size="lg"
        labelVoice="overline"
        label="No-show 7d"
        value={summary.window7dTotal === 0 ? '—' : summary.noShowRate7d}
        unit={summary.window7dTotal === 0 ? undefined : '%'}
        icon={UserRoundX}
        tone="info"
        hint={
          summary.window7dTotal === 0
            ? 'No appointments in the last 7 days'
            : `of ${String(summary.window7dTotal)} in the last 7 days`
        }
      />
    </div>
  );
}
