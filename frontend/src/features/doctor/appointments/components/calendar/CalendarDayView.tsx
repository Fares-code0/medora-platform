import { CalendarPlus } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { cn } from '@/utils/cn';

import { groupByDate, type DateKey } from '../../model/calendar';
import type { Appointment } from '../../model/types';

import { CalendarAppointmentCard } from './CalendarAppointmentCard';

/**
 * Day view — half-hour timeline 08:00–18:00; appointments render as
 * cards inside their start slot (UX 2.4). Semantic list, fully
 * keyboard-operable via the card buttons.
 */

const DAY_GRID_SLOTS: readonly string[] = Array.from({ length: 20 }, (_, index) => {
  const hour = 8 + Math.floor(index / 2);
  return `${String(hour).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`;
});

function slotOf(appointment: Appointment): string {
  const date = new Date(appointment.dateTime);
  return `${String(date.getHours()).padStart(2, '0')}:${date.getMinutes() < 30 ? '00' : '30'}`;
}

export function CalendarDayView({
  date,
  appointments,
  onOpen,
}: {
  date: DateKey;
  appointments: readonly Appointment[];
  onOpen: (appointment: Appointment) => void;
}) {
  const dayAppointments = groupByDate(appointments).get(date) ?? [];

  if (dayAppointments.length === 0) {
    return (
      <EmptyState
        icon={CalendarPlus}
        title="No appointments this day"
        description="Appointments scheduled for this date will appear on the timeline."
      />
    );
  }

  const bySlot = new Map<string, Appointment[]>();
  for (const appointment of dayAppointments) {
    const slot = slotOf(appointment);
    const bucket = bySlot.get(slot);
    if (bucket) bucket.push(appointment);
    else bySlot.set(slot, [appointment]);
  }

  return (
    <ol className="flex flex-col">
      {DAY_GRID_SLOTS.map((slot) => {
        const slotAppointments = bySlot.get(slot) ?? [];
        return (
          <li
            key={slot}
            className={cn(
              'flex min-h-12 gap-3 border-t border-border py-1.5 first:border-t-0',
              slotAppointments.length === 0 && 'opacity-90',
            )}
          >
            <span className="w-14 shrink-0 pt-1 font-mono text-caption text-text-tertiary tabular-nums">
              {slot}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-md">
              {slotAppointments.map((appointment) => (
                <CalendarAppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  density="full"
                  onOpen={onOpen}
                />
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
