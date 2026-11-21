import { CalendarClock, Pause, Play, Trash2 } from 'lucide-react';

import { Alert, EmptyState } from '@/components/feedback';
import { Badge, Button, Card, IconButton } from '@/components/ui';
import { formatDateWith } from '@/i18n';

import { FREQUENCY_LABEL, RANGE_LABEL, REPORT_LABEL, failedSchedules } from './reports';
import type { ScheduledReport } from './reports.types';

/**
 * Scheduled reports (§3.8, "Schedule report (email recurrence)").
 *
 * ## The failure banner is the specified behaviour, not decoration
 *
 * §3.8 ends with "Scheduled-report failures notify the admin via 2.9-equivalent
 * system notification". There is no notification service in this client, and a
 * toast fired on page load would be the wrong shape anyway — a delivery that
 * failed five days ago is a standing condition, not an event. So the failure
 * surfaces as a persistent banner at the top of the panel and as an error
 * badge on the row, both of which survive a reload and neither of which can be
 * dismissed into invisibility while the schedule is still broken. When a real
 * notification service lands this banner is what it mirrors.
 */

export interface ScheduledReportsPanelProps {
  schedules: readonly ScheduledReport[];
  loading: boolean;
  onTogglePause: (schedule: ScheduledReport) => void;
  onDelete: (schedule: ScheduledReport) => void;
  onCreate: () => void;
  busyId: string | null;
}

export function ScheduledReportsPanel({
  schedules,
  loading,
  onTogglePause,
  onDelete,
  onCreate,
  busyId,
}: ScheduledReportsPanelProps) {
  const failed = failedSchedules(schedules);

  return (
    <Card
      title="Scheduled reports"
      subtitle="Recurring deliveries to the people who read them."
      headerAction={
        <Button variant="secondary" size="sm" leadingIcon={CalendarClock} onClick={onCreate}>
          Schedule
        </Button>
      }
    >
      <div className="flex flex-col gap-4" aria-busy={loading || undefined}>
        {failed.length === 0 ? null : (
          <Alert
            variant="error"
            title={
              failed.length === 1
                ? 'A scheduled report failed to deliver'
                : `${failed.length.toString()} scheduled reports failed to deliver`
            }
          >
            <ul className="flex flex-col gap-1">
              {failed.map((schedule) => (
                <li key={schedule.id}>
                  <span className="font-medium">{schedule.name}</span> —{' '}
                  {schedule.lastRun?.detail ?? 'No detail was recorded.'}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {schedules.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No scheduled reports"
            description="Schedule the report you are looking at and it will be built and emailed on a recurrence."
            action={
              <Button variant="secondary" size="sm" onClick={onCreate}>
                Schedule this report
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                busy={busyId === schedule.id}
                onTogglePause={onTogglePause}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ScheduleRow({
  schedule,
  busy,
  onTogglePause,
  onDelete,
}: {
  schedule: ScheduledReport;
  busy: boolean;
  onTogglePause: (schedule: ScheduledReport) => void;
  onDelete: (schedule: ScheduledReport) => void;
}) {
  const lastRun = schedule.lastRun;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-[200px] flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-text-primary">{schedule.name}</span>
          {schedule.paused ? (
            <Badge variant="neutral" emphasis="outline">
              Paused
            </Badge>
          ) : null}
          {lastRun?.status === 'failed' ? <Badge variant="error">Last run failed</Badge> : null}
        </div>

        <p className="text-caption text-text-secondary">
          {REPORT_LABEL[schedule.reportId]} · {RANGE_LABEL[schedule.range]} ·{' '}
          {FREQUENCY_LABEL[schedule.frequency]} · {schedule.format.toUpperCase()}
        </p>

        <p className="text-caption text-text-tertiary">
          {schedule.recipients.length === 1
            ? schedule.recipients[0]
            : `${schedule.recipients.length.toString()} recipients`}
          {' · '}
          {schedule.paused ? 'Paused' : `Next ${formatWhen(schedule.nextRunAt)}`}
          {lastRun === null ? ' · Never run' : ` · Last ${formatWhen(lastRun.at)}`}
        </p>

        {/*
         * The reason is on the row as well as in the banner. A reader who
         * scrolls past the banner still needs to know why this particular
         * schedule failed, and "check the alert above" is not an answer once
         * there are three of them.
         */}
        {lastRun?.status === 'failed' ? (
          <p className="text-caption text-error">{lastRun.detail}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          icon={schedule.paused ? Play : Pause}
          aria-label={schedule.paused ? `Resume ${schedule.name}` : `Pause ${schedule.name}`}
          size="sm"
          disabled={busy}
          onClick={() => {
            onTogglePause(schedule);
          }}
        />
        <IconButton
          icon={Trash2}
          aria-label={`Delete ${schedule.name}`}
          size="sm"
          variant="destructive-secondary"
          disabled={busy}
          onClick={() => {
            onDelete(schedule);
          }}
        />
      </div>
    </li>
  );
}

/**
 * Local wall clock, matching ADM-07's table.
 *
 * A schedule that says "07:00" has to mean seven o'clock where the reader is,
 * or the next-run column is off by their offset — the exact bug ADM-07 fixed
 * when its timestamps were UTC and its filters were local.
 */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatDateWith(date, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
