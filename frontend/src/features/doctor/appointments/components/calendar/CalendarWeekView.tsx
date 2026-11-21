import { formatDateWith } from '@/i18n';
import { cn } from '@/utils/cn';

import { parseDateKey, groupByDate, todayKey, weekDays, type DateKey } from '../../model/calendar';
import type { Appointment } from '../../model/types';

import { CalendarAppointmentCard } from './CalendarAppointmentCard';

/**
 * Week view — Monday-first, seven day columns of appointment cards.
 * Today's column is highlighted; the grid scrolls horizontally below
 * lg so no day is lost on small screens (UX §5.2).
 */


export function CalendarWeekView({
  date,
  appointments,
  onOpen,
  onOpenDay,
}: {
  date: DateKey;
  appointments: readonly Appointment[];
  onOpen: (appointment: Appointment) => void;
  onOpenDay: (date: DateKey) => void;
}) {
  const byDate = groupByDate(appointments);
  const days = weekDays(date);
  const today = todayKey();

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[840px] grid-cols-7 gap-2">
        {days.map((day) => {
          const dayAppointments = byDate.get(day) ?? [];
          const isToday = day === today;
          return (
            <section
              key={day}
              aria-label={parseDateKey(day).toDateString()}
              className={cn(
                'flex min-h-40 flex-col gap-1.5 rounded-surface border border-border bg-background p-1.5',
                isToday && 'border-primary bg-primary-subtle',
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                aria-label={`Open day view for ${parseDateKey(day).toDateString()}`}
                className={cn(
                  'flex items-baseline justify-between rounded-control px-1 text-caption font-semibold',
                  'transition-colors duration-fast hover:text-primary',
                  isToday ? 'text-primary' : 'text-text-secondary',
                )}
              >
                <span>{formatDateWith(parseDateKey(day), { weekday: 'short' })}</span>
                <span className="tabular-nums">{formatDateWith(parseDateKey(day), { day: 'numeric' })}</span>
              </button>
              {dayAppointments.map((appointment) => (
                <CalendarAppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  density="full"
                  onOpen={onOpen}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
