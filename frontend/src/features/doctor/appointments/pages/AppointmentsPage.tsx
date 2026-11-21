import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CalendarDays,
  CalendarOff,
  CalendarPlus,
  CalendarRange,
  Download,
  RefreshCw,
  SearchX,
  SlidersHorizontal,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useToast } from '@/app/providers';
import { Alert, EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { ExportButton, FilterBar, SearchBar } from '@/components/patterns';
import {
  Breadcrumb,
  Button,
  Card,
  ConfirmationDialog,
  DataTable,
  IconButton,
  Pagination,
  Tabs,
  Tooltip,
} from '@/components/ui';
import { DEFAULT_PAGE_SIZE } from '@/constants';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatDateTime } from '@/i18n';
import { routes } from '@/routes';
import { isApiError } from '@/types/api';
import { runExport, type ExportDataset } from '@/utils/export';
import { pageSlice } from '@/utils/pagination';

import {
  useAppointmentsQuery,
  useAppointmentActionMutation,
  type AppointmentCommand,
} from '../api/useAppointmentsQuery';
import { buildAppointmentColumns } from '../components/appointment-table-columns';
import { AppointmentCardList } from '../components/AppointmentCardList';
import { AppointmentDetailsDrawer } from '../components/AppointmentDetailsDrawer';
import { AppointmentFiltersDrawer } from '../components/AppointmentFiltersDrawer';
import { AppointmentsSummaryCards } from '../components/AppointmentsSummaryCards';
import { BlockTimeOffDialog } from '../components/BlockTimeOffDialog';
import { CalendarDateNavigator } from '../components/calendar/CalendarDateNavigator';
import { CalendarDayView } from '../components/calendar/CalendarDayView';
import { CalendarMonthView } from '../components/calendar/CalendarMonthView';
import { CalendarWeekView } from '../components/calendar/CalendarWeekView';
import { ProposeSlotsDialog } from '../components/ProposeSlotsDialog';
import { ReasonDialog } from '../components/ReasonDialog';
import { RescheduleDialog } from '../components/RescheduleDialog';
import { UpcomingTimeOffDrawer } from '../components/UpcomingTimeOffDrawer';
import { useAppointmentListState, type AppointmentsView } from '../hooks/useAppointmentListState';
import {
  REJECT_CATEGORY_LABELS,
  type RejectCategory,
} from '../model/appointment-service';
import { toActiveFilterChips } from '../model/filters';
import { filterAppointments, sortAppointments, summarizeAppointments } from '../model/selectors';
import { type Appointment, type AppointmentAction } from '../model/types';
import { appointmentService } from '../service';

/**
 * Appointments page — UX 2.4. One URL-driven surface with four views
 * (List = P1 table; Day/Week/Month = calendar cards) over the same
 * filtered dataset. The details drawer is deep-linkable via
 * /doctor/appointments/:appointmentId; every transition flows through
 * the status machine, with P4 confirm-with-reason wherever another
 * human is affected.
 */

/** The API's five decline categories, offered by their labels (API §5.4). */
const REJECT_REASONS: readonly string[] = Object.values(REJECT_CATEGORY_LABELS);

function rejectCategoryOf(label: string): RejectCategory {
  const match = (Object.entries(REJECT_CATEGORY_LABELS) as [RejectCategory, string][]).find(
    ([, candidate]) => candidate === label,
  );
  return match?.[0] ?? 'other';
}

/** "Doctor unavailable — on call" — the reason the patient is sent. */
function withDetail(label: string, details: string): string {
  const detail = details.trim();
  return detail === '' ? label : `${label} — ${detail}`;
}

/**
 * What to tell the doctor when a transition is refused. The API answers a
 * refusal with a 409 and says why (`slot_conflict`: "The slot falls outside
 * the doctor's working hours"); that sentence is the useful part, so it is
 * shown as given. Anything else gets the generic line.
 */
function refusalOf(error: unknown): string {
  if (isApiError(error) && error.kind === 'conflict') return error.detail;
  if (isApiError(error) && error.kind === 'validation') {
    const first = Object.values(error.fieldErrors)[0]?.[0];
    if (first !== undefined) return first;
  }
  return 'Nothing was changed — try again.';
}

const CANCEL_REASONS: readonly string[] = [
  'Doctor unavailable',
  'Patient requested cancellation',
  'Duplicate booking',
  'Other',
];

type PendingDialog = {
  readonly kind: AppointmentAction;
  readonly appointment: Appointment;
} | null;

function appointmentsDataset(rows: readonly Appointment[]): ExportDataset {
  return {
    filename: 'medora-appointments',
    title: 'Appointments',
    columns: [
      'ID',
      'Patient',
      'MRN',
      'Date & time',
      'Visit type',
      'Department',
      'Status',
      'Priority',
    ],
    rows: rows.map((a) => [
      a.id,
      a.patient.name,
      a.patient.mrn,
      formatDateTime(a.dateTime),
      a.visitType,
      a.department,
      a.status,
      a.priority,
    ]),
  };
}

export function AppointmentsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { appointmentId } = useParams();
  const isMd = useMediaQuery('(min-width: 768px)');
  const filtersDrawer = useDisclosure();
  const timeOffDialog = useDisclosure();
  const timeOffList = useDisclosure();

  /*
   * NEW-06's `?book=<patientId>` once opened a dialog here. Booking is now
   * its own page; an old link or bookmark is replaced by it, patient kept,
   * so back-navigation never lands on the param again.
   */
  const [searchParams] = useSearchParams();
  const bookParam = searchParams.get('book');
  useEffect(() => {
    if (bookParam === null) return;
    const patientId = bookParam.trim();
    navigate(routes.doctor.bookAppointment(patientId === '' ? undefined : { patientId }), {
      replace: true,
    });
  }, [bookParam, navigate]);

  const list = useAppointmentListState();
  const { data, isPending, isError, isFetching, refetch } = useAppointmentsQuery();
  const mutation = useAppointmentActionMutation();

  const [searchInput, setSearchInput] = useState(list.q);
  useEffect(() => setSearchInput(list.q), [list.q]);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [dialog, setDialog] = useState<PendingDialog>(null);

  const appointments = useMemo(() => data ?? [], [data]);
  const doctors = useMemo(
    () => [...new Set(appointments.map((row) => row.doctor))].sort((a, b) => a.localeCompare(b)),
    [appointments],
  );
  const summary = useMemo(() => summarizeAppointments(appointments), [appointments]);
  const filtered = useMemo(
    () => filterAppointments(appointments, list.q, list.filters),
    [appointments, list.q, list.filters],
  );
  const sorted = useMemo(() => sortAppointments(filtered, list.sort), [filtered, list.sort]);
  const pageRows = useMemo(
    () => pageSlice(sorted, list.page, list.pageSize),
    [sorted, list.page, list.pageSize],
  );

  // Deep link (UX §1.3): /doctor/appointments/:appointmentId opens the drawer.
  const activeAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === appointmentId) ?? null,
    [appointments, appointmentId],
  );
  /*
   * A link that names an appointment the loaded book does not hold — a stale
   * notification, a cancelled visit, someone else's, a typo. Opening nothing
   * and saying nothing reads as a broken button; say so, as the lab and record
   * detail pages do. Only once the book has loaded: a pending list is not an
   * absent appointment, and a failed one is reported by its own error state.
   */
  const unresolvedAppointmentId =
    appointmentId !== undefined && !isPending && !isError && activeAppointment === null
      ? appointmentId
      : null;

  const openDetails = useCallback(
    (appointment: Appointment) => {
      navigate(`${routes.doctor.appointment(appointment.id)}${window.location.search}`);
    },
    [navigate],
  );
  const closeDetails = useCallback(() => {
    navigate(`${routes.doctor.appointments}${window.location.search}`);
  }, [navigate]);

  const runTransition = useCallback(
    (appointment: Appointment, command: AppointmentCommand, successTitle: string) => {
      mutation.mutate(
        { id: appointment.id, command },
        {
          onSuccess: () => {
            setDialog(null);
            toast({ variant: 'success', title: successTitle });
          },
          onError: (error) => {
            toast({
              variant: 'error',
              title: "Couldn't update the appointment",
              description: refusalOf(error),
            });
          },
        },
      );
    },
    [mutation, toast],
  );

  const onAction = useCallback(
    (action: AppointmentAction, appointment: Appointment) => {
      if (action === 'approve') {
        runTransition(appointment, { kind: 'approve' }, `${appointment.id} confirmed`);
        return;
      }
      setDialog({ kind: action, appointment });
    },
    [runTransition],
  );

  const columns = useMemo(
    () => buildAppointmentColumns({ onOpenDetails: openDetails, onAction }),
    [openDetails, onAction],
  );

  const activeChips = toActiveFilterChips(list.filters);
  const hasSearchOrFilters = list.q !== '' || list.hasActiveFilters;

  const emptyState = hasSearchOrFilters ? (
    <EmptyState
      icon={SearchX}
      title="No appointments match"
      description="Nothing matches the current search and filters."
      action={
        <Button
          variant="secondary"
          onClick={() => {
            setSearchInput('');
            list.setQuery('');
            list.clearFilters();
          }}
        >
          Clear search & filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={CalendarPlus}
      tone="warning"
      title="No appointments yet"
      description="Appointments appear here when patients book with you."
    />
  );

  const tableError = isError
    ? { title: "Couldn't load appointments", onRetry: () => void refetch() }
    : undefined;

  const openDay = (date: string) => {
    list.setDate(date);
    list.setView('day');
  };

  const isCalendarView = list.view !== 'list';

  /*
   * A worklist is read top-to-bottom under time pressure, so vertical
   * chrome is charged against the rows it displaces: the page padding and
   * the gaps between header, KPI strip and table are the tightest the
   * layout scale allows (ADR-0001, density target).
   */
  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Appointments"
          caption="Review, decide, and manage your schedule."
          icon={CalendarDays}
          tone="warning"
          breadcrumb={
            <Breadcrumb
              items={[
                { label: 'Overview', href: routes.doctor.overview },
                { label: 'Appointments' },
              ]}
            />
          }
          actions={
            <>
              {/* Icon-only below sm, label kept for assistive tech: three
                  labelled buttons do not fit a 375px header. */}
              <Button variant="ghost" leadingIcon={CalendarRange} onClick={timeOffList.open}>
                <span className="sr-only sm:not-sr-only">Upcoming time off</span>
              </Button>
              <Button variant="secondary" leadingIcon={CalendarOff} onClick={timeOffDialog.open}>
                Block time off
              </Button>
              <Button
                leadingIcon={CalendarPlus}
                onClick={() => navigate(routes.doctor.bookAppointment())}
              >
                New appointment
              </Button>
            </>
          }
        />

        {unresolvedAppointmentId !== null ? (
          <Alert
            variant="warning"
            title="This appointment is not in your book"
            onDismiss={closeDetails}
          >
            {`No appointment ${unresolvedAppointmentId} is visible to you. It may have been removed, or the link may be out of date.`}
          </Alert>
        ) : null}

        <AppointmentsSummaryCards summary={summary} loading={isPending} />

        <Stack gap={4}>
          <FilterBar
            filters={activeChips}
            onRemove={list.removeFilter}
            onClearAll={list.clearFilters}
            search={
              <SearchBar
                label="Search appointments"
                placeholder="Search patient, MRN, appointment ID, phone…"
                value={searchInput}
                onValueChange={setSearchInput}
                onDebouncedChange={list.setQuery}
                resultCount={isPending ? null : filtered.length}
              />
            }
            actions={
              <>
                <Tooltip content="Refresh">
                  <IconButton
                    icon={RefreshCw}
                    aria-label="Refresh appointments"
                    loading={isFetching && !isPending}
                    onClick={() => void refetch()}
                  />
                </Tooltip>
                <ExportButton
                  getDataset={() => appointmentsDataset(sorted)}
                  onExported={(format) =>
                    toast({
                      variant: 'success',
                      title: `Appointments exported (${format.toUpperCase()})`,
                    })
                  }
                />
                <Button
                  variant="secondary"
                  leadingIcon={SlidersHorizontal}
                  onClick={filtersDrawer.open}
                  aria-expanded={filtersDrawer.isOpen}
                >
                  Filters{activeChips.length > 0 ? ` (${String(activeChips.length)})` : ''}
                </Button>
              </>
            }
          />

          {/*
            The view switcher keeps a band of its own. It was briefly merged
            into the filter row to reclaim 56px, which worked, but a view
            switch is navigation and the merge filed it among tools
            (Refresh / Export / Filters) 830px from the field it shared a
            row with. The density target is met at 12 rows without those
            pixels, so the height is not worth the reclassification.
          */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              aria-label="Appointments view"
              variant="enclosed"
              value={list.view}
              onValueChange={(value) => list.setView(value as AppointmentsView)}
              items={[
                { value: 'list', label: 'List' },
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
            />
            {isCalendarView ? (
              <CalendarDateNavigator
                view={list.view}
                date={list.date}
                onDateChange={list.setDate}
              />
            ) : null}
          </div>

          {list.view === 'list' ? (
            <>
              {selectedIds.length > 0 ? (
                <div
                  role="status"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-primary-subtle px-4 py-2"
                >
                  <p className="text-body-sm font-medium text-primary">
                    {selectedIds.length} appointment{selectedIds.length === 1 ? '' : 's'} selected
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={Download}
                      onClick={() => {
                        const selected = sorted.filter((a) => selectedIds.includes(a.id));
                        runExport('csv', {
                          ...appointmentsDataset(selected),
                          filename: 'medora-appointments-selected',
                        });
                        toast({
                          variant: 'success',
                          title: `Exported ${String(selected.length)} appointments`,
                        });
                      }}
                    >
                      Export selected
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                      Clear selection
                    </Button>
                  </div>
                </div>
              ) : null}

              {/*
                Comfortable rows, not dense. The 32px dense row was chosen to
                fit more of the day on screen, but with ten rows a page the
                page no longer needs it, and at that height names, dates and
                status badges were hard to scan.
              */}
              {isMd ? (
                <DataTable
                  caption="Appointments with patient, schedule, status, and priority details"
                  columns={columns}
                  rows={pageRows}
                  getRowId={(appointment) => appointment.id}
                  sort={list.sort ?? undefined}
                  onSortChange={list.setSort}
                  selectable
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  onRowClick={openDetails}
                  loading={isPending}
                  loadingRowCount={DEFAULT_PAGE_SIZE}
                  error={tableError}
                  emptyState={emptyState}
                  stickyHeader
                />
              ) : (
                <AppointmentCardList
                  appointments={pageRows}
                  onOpenDetails={openDetails}
                  onAction={onAction}
                  loading={isPending}
                  error={tableError}
                  emptyState={emptyState}
                />
              )}

              {!isPending && !isError && sorted.length > 0 ? (
                <Pagination
                  page={list.page}
                  pageSize={list.pageSize}
                  totalItems={sorted.length}
                  onPageChange={list.setPage}
                  onPageSizeChange={list.setPageSize}
                />
              ) : null}
            </>
          ) : (
            <Card padding="compact">
              {list.view === 'day' ? (
                <CalendarDayView date={list.date} appointments={filtered} onOpen={openDetails} />
              ) : list.view === 'week' ? (
                <CalendarWeekView
                  date={list.date}
                  appointments={filtered}
                  onOpen={openDetails}
                  onOpenDay={openDay}
                />
              ) : (
                <CalendarMonthView
                  date={list.date}
                  appointments={filtered}
                  onOpen={openDetails}
                  onOpenDay={openDay}
                />
              )}
            </Card>
          )}
        </Stack>
      </PageSections>

      <BlockTimeOffDialog open={timeOffDialog.isOpen} onClose={timeOffDialog.close} />
      <UpcomingTimeOffDrawer open={timeOffList.isOpen} onClose={timeOffList.close} />

      <AppointmentFiltersDrawer
        doctors={doctors}
        open={filtersDrawer.isOpen}
        onClose={filtersDrawer.close}
        filters={list.filters}
        onFilterChange={list.setFilter}
        onClear={list.clearFilters}
      />

      <AppointmentDetailsDrawer
        appointment={activeAppointment}
        open={activeAppointment !== null && dialog === null}
        onClose={closeDetails}
        onAction={onAction}
        actionPending={mutation.isPending}
      />

      {dialog !== null && (dialog.kind === 'reject' || dialog.kind === 'cancel') ? (
        <ReasonDialog
          open
          title={
            dialog.kind === 'reject'
              ? `Reject ${dialog.appointment.id}?`
              : `Cancel ${dialog.appointment.id}?`
          }
          consequence={`${dialog.appointment.patient.name} will be notified immediately with the reason.`}
          confirmLabel={dialog.kind === 'reject' ? 'Reject request' : 'Cancel appointment'}
          reasonOptions={dialog.kind === 'reject' ? REJECT_REASONS : CANCEL_REASONS}
          loading={mutation.isPending}
          onConfirm={(reason, details) =>
            runTransition(
              dialog.appointment,
              dialog.kind === 'reject'
                ? { kind: 'reject', category: rejectCategoryOf(reason), detail: details }
                : { kind: 'cancel', reason: withDetail(reason, details) },
              dialog.kind === 'reject'
                ? `${dialog.appointment.id} declined`
                : `${dialog.appointment.id} cancelled`,
            )
          }
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog !== null && (dialog.kind === 'complete' || dialog.kind === 'no-show') ? (
        <ConfirmationDialog
          open
          title={
            dialog.kind === 'complete'
              ? `Mark ${dialog.appointment.id} as completed?`
              : `Mark ${dialog.appointment.id} as a no-show?`
          }
          description={
            dialog.kind === 'complete'
              ? 'The consultation will be recorded as completed.'
              : `${dialog.appointment.patient.name} will be recorded as absent for this appointment.`
          }
          confirmLabel={dialog.kind === 'complete' ? 'Mark completed' : 'Mark no-show'}
          tone={dialog.kind === 'complete' ? 'primary' : 'destructive'}
          loading={mutation.isPending}
          onConfirm={() =>
            runTransition(
              dialog.appointment,
              { kind: dialog.kind === 'complete' ? 'complete' : 'no-show' },
              dialog.kind === 'complete'
                ? `${dialog.appointment.id} marked completed`
                : `${dialog.appointment.id} marked as no-show`,
            )
          }
          onClose={() => setDialog(null)}
        />
      ) : null}

      <RescheduleDialog
        open={dialog?.kind === 'reschedule'}
        appointment={dialog?.kind === 'reschedule' ? dialog.appointment : null}
        allAppointments={appointments}
        loading={mutation.isPending}
        simulateBusy={appointmentService.capabilities.simulatedBusySlots}
        onConfirm={(appointment, newDateTimeIso, reason) =>
          runTransition(
            appointment,
            { kind: 'reschedule', dateTime: newDateTimeIso, reason },
            `${appointment.id} rescheduled`,
          )
        }
        onClose={() => setDialog(null)}
      />

      <ProposeSlotsDialog
        // Keyed by request so a proposal never opens pre-filled with the
        // previous request's slots.
        key={dialog?.kind === 'propose-slots' ? dialog.appointment.id : 'none'}
        open={dialog?.kind === 'propose-slots'}
        appointment={dialog?.kind === 'propose-slots' ? dialog.appointment : null}
        allAppointments={appointments}
        loading={mutation.isPending}
        simulateBusy={appointmentService.capabilities.simulatedBusySlots}
        onConfirm={(appointment, slots, reason) =>
          runTransition(
            appointment,
            { kind: 'propose-slots', slots, reason },
            `Proposed ${String(slots.length)} time${slots.length === 1 ? '' : 's'} to ${appointment.patient.name}`,
          )
        }
        onClose={() => setDialog(null)}
      />
    </PageContainer>
  );
}
