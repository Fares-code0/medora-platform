import { StatusBadge } from '@/components/patterns';
import { cn } from '@/utils/cn';
import { formatTime } from '@/utils/dates';

import {
  APPOINTMENT_PRIORITY_META,
  APPOINTMENT_STATUS_META,
  type Appointment,
} from '../../model/types';

/**
 * Appointment card for the calendar views (UX 2.4). Two densities:
 * `full` (Day/Week — time, patient, status) and `chip` (Month cells —
 * one line). Every card is a real button (keyboard-operable) opening
 * the details drawer; urgent/high priority carries a visible badge,
 * never color alone.
 */
export interface CalendarAppointmentCardProps {
  appointment: Appointment;
  density: 'full' | 'chip';
  onOpen: (appointment: Appointment) => void;
}

export function CalendarAppointmentCard({
  appointment,
  density,
  onOpen,
}: CalendarAppointmentCardProps) {
  const statusMeta = APPOINTMENT_STATUS_META[appointment.status];
  const isMuted = appointment.status === 'cancelled' || appointment.status === 'no-show';
  const showPriority = appointment.priority === 'high' || appointment.priority === 'urgent';

  if (density === 'chip') {
    return (
      <button
        type="button"
        onClick={() => onOpen(appointment)}
        aria-label={`${formatTime(appointment.dateTime)} ${appointment.patient.name}, ${statusMeta.label}`}
        className={cn(
          'flex w-full items-center gap-1 truncate rounded-control border border-border bg-surface px-1.5 py-0.5 text-start text-caption',
          'transition-colors duration-fast ease-out hover:border-primary hover:bg-primary-subtle',
          isMuted && 'opacity-60',
        )}
      >
        <span className="shrink-0 font-mono text-text-secondary">
          {formatTime(appointment.dateTime)}
        </span>
        <span className="truncate font-medium text-text-primary">{appointment.patient.name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(appointment)}
      className={cn(
        'flex w-full flex-col gap-1 rounded-surface border border-border bg-surface p-2 text-start',
        // `hover:border-primary` is the whole hover affordance. The aliased
        // `hover:shadow-sm` added a second, border-coloured ring outside the
        // primary border on hover — a muddy double edge, not a lift.
        'transition-[border-color] duration-fast ease-out hover:border-primary',
        isMuted && 'opacity-60',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-caption text-text-secondary tabular-nums">
          {formatTime(appointment.dateTime)} · {appointment.durationMin}m
        </span>
        {showPriority ? (
          <StatusBadge
            status={APPOINTMENT_PRIORITY_META[appointment.priority].kind}
            label={APPOINTMENT_PRIORITY_META[appointment.priority].label}
          />
        ) : null}
      </span>
      <span className="truncate text-body-sm font-medium text-text-primary">
        {appointment.patient.name}
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-caption text-text-tertiary">{appointment.visitType}</span>
        <StatusBadge status={statusMeta.kind} label={statusMeta.label} />
      </span>
    </button>
  );
}
