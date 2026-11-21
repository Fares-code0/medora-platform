import { AlertTriangle, ArrowUp } from 'lucide-react';

import { StatusBadge } from '@/components/patterns';
import { Avatar, Badge } from '@/components/ui';
import { cn } from '@/utils/cn';

import {
  APPOINTMENT_PRIORITY_META,
  APPOINTMENT_STATUS_META,
  type Appointment,
} from '../model/types';

/**
 * Small presentational cells shared by the table, the mobile cards, and
 * the details drawer — one implementation per visual.
 */

export function AppointmentPatientCell({ appointment }: { appointment: Appointment }) {
  /*
   * One line, not two. The stacked name-over-demographics block was the
   * tallest cell in the row and set the height of the whole worklist; age
   * and sex are metadata a clinician glances at, so they sit inline after
   * the name rather than claiming a second line of every row.
   */
  return (
    <div className="flex items-center gap-2">
      <Avatar name={appointment.patient.name} size="xs" decorative />
      <span className="truncate text-body-sm font-medium text-text-primary">
        {appointment.patient.name}
      </span>
      <span className="shrink-0 text-caption text-text-tertiary tabular-nums">
        <span dir="ltr">
          {appointment.patient.age} · {appointment.patient.gender === 'female' ? 'F' : 'M'}
        </span>
      </span>
      {appointment.isNewPatient ? <Badge variant="info">New</Badge> : null}
    </div>
  );
}

export function AppointmentStatusBadge({ appointment }: { appointment: Appointment }) {
  const meta = APPOINTMENT_STATUS_META[appointment.status];
  return <StatusBadge status={meta.kind} label={meta.label} />;
}

/**
 * Priority is an ordinal ramp (low → urgent), not a set of semantic states,
 * so badging all four values borrowed the status palette for a second
 * purpose: in adjacent columns, Normal rendered the same green as Confirmed
 * and High the same amber as Pending, and a reader could not tell which
 * column a colour belonged to.
 *
 * Two things separate the columns now. Only the exceptional values are
 * marked at all — Normal and Low, the great majority of rows, stay quiet
 * text — and the marked ones carry an ICON ON BARE GROUND rather than a
 * filled pill. Urgent still has to share amber and red with the status
 * vocabulary (both columns mean "needs attention", and inventing a hue for
 * priority would undo the palette reduction), so form carries what hue
 * cannot. It also keeps priority off colour alone, per WCAG 1.4.1.
 */
export function AppointmentPriorityBadge({ appointment }: { appointment: Appointment }) {
  const meta = APPOINTMENT_PRIORITY_META[appointment.priority];

  if (appointment.priority !== 'high' && appointment.priority !== 'urgent') {
    return <span className="text-caption text-text-tertiary">{meta.label}</span>;
  }

  const isUrgent = appointment.priority === 'urgent';
  const Icon = isUrgent ? AlertTriangle : ArrowUp;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap text-caption font-semibold',
        isUrgent ? 'text-error' : 'text-warning',
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
      {meta.label}
    </span>
  );
}
