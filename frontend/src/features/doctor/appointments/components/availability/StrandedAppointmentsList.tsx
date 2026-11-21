import { Badge, LinkButton } from '@/components/ui';
import { formatDateWith } from '@/i18n';
import { routes } from '@/routes';
import { formatDate, formatTime } from '@/utils/dates';

import { STRAND_REASON_LABELS, type StrandedRow } from '../../model/availability';

/**
 * Upcoming appointments the hours do not cover (DEC-005) — the editor's
 * preview before a save, or the server's report after one (BR-DEC-005).
 * Each links to the appointment, whose drawer holds the existing Reschedule
 * and Cancel actions; nothing here acts on an appointment itself.
 *
 * Times are shown as every appointment screen shows them, in the device's
 * zone. The hours are the clinic's wall clock, so where the clinic's zone is
 * known and reads differently, its time is added beside it — otherwise
 * "outside the working hours" could sit next to a time inside them.
 */

function clinicTime(dateTime: string, clinicZone: string | null): string | null {
  if (clinicZone === null) return null;
  const options = { hour: '2-digit', minute: '2-digit', hour12: false } as const;
  const there = formatDateWith(dateTime, { ...options, timeZone: clinicZone });
  return there === formatDateWith(dateTime, options) ? null : there;
}

export function StrandedAppointmentsList({
  rows,
  clinicZone = null,
}: {
  readonly rows: readonly StrandedRow[];
  /** The clinic's zone, when the server has said; `null` for none. */
  readonly clinicZone?: string | null;
}) {
  return (
    <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-control border border-border">
      {rows.map(({ id, dateTime, patientLabel, reason, alreadyOutside }) => {
        const there = clinicTime(dateTime, clinicZone);
        return (
          <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-text-primary">
                <span className="tabular-nums">
                  {formatDate(dateTime)} · {formatTime(dateTime)}
                  {there === null ? null : ` (${there} clinic time)`}
                </span>{' '}
                — {patientLabel}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
                {reason === null ? 'Outside the saved hours' : STRAND_REASON_LABELS[reason]}
                {alreadyOutside ? (
                  <Badge variant="neutral">Already outside your current hours</Badge>
                ) : null}
              </p>
            </div>
            <LinkButton
              href={routes.doctor.appointment(id)}
              variant="secondary"
              size="sm"
              aria-label={`Open appointment ${id} to reschedule`}
            >
              Open to reschedule
            </LinkButton>
          </li>
        );
      })}
    </ul>
  );
}
