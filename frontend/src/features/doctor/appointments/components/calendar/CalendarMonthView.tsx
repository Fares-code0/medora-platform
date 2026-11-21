import { cn } from '@/utils/cn';

import { monthGrid, parseDateKey, todayKey, groupByDate, type DateKey } from '../../model/calendar';
import type { Appointment } from '../../model/types';

import { CalendarAppointmentCard } from './CalendarAppointmentCard';

/**
 * Month view — density overview (UX 2.4): day cells show up to three
 * appointment chips plus "+N more", which jumps to the day view.
 * Scrolls horizontally on narrow screens rather than dropping days.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MAX_CHIPS = 3;

export function CalendarMonthView({
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
  const weeks = monthGrid(date);
  const today = todayKey();

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[840px]">
        <div className="grid grid-cols-7 gap-2 pb-2">
          {WEEKDAYS.map((weekday) => (
            <p
              key={weekday}
              className="px-1 text-caption font-semibold uppercase tracking-wider text-text-tertiary"
            >
              {weekday}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7 gap-2">
              {week.map((cell) => {
                const cellAppointments = byDate.get(cell.key) ?? [];
                const overflow = cellAppointments.length - MAX_CHIPS;
                const isToday = cell.key === today;
                return (
                  <div
                    key={cell.key}
                    className={cn(
                      'flex min-h-24 flex-col gap-1 rounded-surface border border-border p-1.5',
                      cell.inMonth ? 'bg-background' : 'bg-surface-sunken opacity-60',
                      isToday && 'border-primary',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenDay(cell.key)}
                      aria-label={`Open day view for ${parseDateKey(cell.key).toDateString()}`}
                      className={cn(
                        'self-start rounded-pill px-1.5 text-caption font-semibold tabular-nums',
                        'transition-colors duration-fast hover:text-primary',
                        isToday
                          ? 'bg-primary text-text-inverse hover:text-text-inverse'
                          : 'text-text-secondary',
                      )}
                    >
                      {parseDateKey(cell.key).getDate()}
                    </button>
                    {cellAppointments.slice(0, MAX_CHIPS).map((appointment) => (
                      <CalendarAppointmentCard
                        key={appointment.id}
                        appointment={appointment}
                        density="chip"
                        onOpen={onOpen}
                      />
                    ))}
                    {overflow > 0 ? (
                      <button
                        type="button"
                        onClick={() => onOpenDay(cell.key)}
                        className="self-start rounded-control px-1.5 text-caption font-medium text-primary transition-colors duration-fast hover:text-primary-hover"
                      >
                        +{overflow} more
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
