import { useState } from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { IconButton } from '@/components/ui';
import { formatDateWith } from '@/i18n';
import { cn } from '@/utils/cn';

import type { WeeklyAvailability } from '../../model/availability';
import { dateKeyAsUtcNoon, dateState, type DateState } from '../../model/booking';
import { addMonths, monthGrid, type DateKey } from '../../model/calendar';

/**
 * The booking calendar: one month of the clinic's civil dates.
 *
 * Every date is a real button. A date before the clinic's today, or on a
 * weekday the doctor does not work, is disabled and says why in its name —
 * state is never carried by colour alone (ADR-0001). Dates are formatted as
 * UTC noon with `timeZone: 'UTC'`, so the label is the date key itself and
 * no device zone can shift it across midnight.
 */
export interface BookingCalendarProps {
  readonly selected: DateKey | null;
  readonly onSelect: (date: DateKey) => void;
  readonly availability: WeeklyAvailability;
  /** The clinic's today — the first bookable date. */
  readonly today: DateKey;
  readonly error?: string | undefined;
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const STATE_SUFFIX: Readonly<Record<DateState, string>> = {
  open: 'working day',
  closed: 'not a working day',
  past: 'in the past',
};

function firstOfMonth(date: DateKey): DateKey {
  return `${date.slice(0, 7)}-01`;
}

export function BookingCalendar({
  selected,
  onSelect,
  availability,
  today,
  error,
}: BookingCalendarProps) {
  const [month, setMonth] = useState<DateKey>(() => firstOfMonth(selected ?? today));
  const atFirstMonth = month <= firstOfMonth(today);
  const errorId = 'booking-date-error';

  return (
    <div
      className={cn(
        'rounded-surface border bg-surface p-3 sm:p-4',
        error === undefined ? 'border-border' : 'border-error',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <IconButton
          icon={ChevronLeft}
          aria-label="Previous month"
          variant="ghost"
          size="sm"
          disabled={atFirstMonth}
          onClick={() => setMonth((current) => addMonths(current, -1))}
        />
        <p className="text-body-sm font-semibold text-text-primary" aria-live="polite">
          {formatDateWith(dateKeyAsUtcNoon(month), {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          })}
        </p>
        <IconButton
          icon={ChevronRight}
          aria-label="Next month"
          variant="ghost"
          size="sm"
          onClick={() => setMonth((current) => addMonths(current, 1))}
        />
      </div>

      <div
        role="group"
        aria-label="Appointment date"
        aria-describedby={error === undefined ? undefined : errorId}
        className="mt-3"
      >
        <div className="grid grid-cols-7 gap-1" aria-hidden="true">
          {WEEKDAY_HEADERS.map((weekday) => (
            <span
              key={weekday}
              className="py-1 text-center text-caption font-medium text-text-tertiary"
            >
              {weekday}
            </span>
          ))}
        </div>
        {monthGrid(month).map((week) => (
          <div key={week[0]?.key} className="mt-1 grid grid-cols-7 gap-1">
            {week.map((cell) => {
              if (!cell.inMonth) return <span key={cell.key} aria-hidden="true" />;
              const state = dateState(cell.key, availability, today);
              const isSelected = cell.key === selected;
              const isToday = cell.key === today;
              const label = formatDateWith(dateKeyAsUtcNoon(cell.key), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              });
              return (
                <button
                  key={cell.key}
                  type="button"
                  disabled={state !== 'open'}
                  aria-pressed={isSelected}
                  aria-label={`${label}${isToday ? ', today' : ''} — ${STATE_SUFFIX[state]}`}
                  onClick={() => onSelect(cell.key)}
                  className={cn(
                    'relative flex h-10 items-center justify-center rounded-control text-body-sm tabular-nums',
                    'transition-colors duration-fast',
                    state === 'open' &&
                      !isSelected &&
                      'font-medium text-text-primary hover:bg-primary-subtle',
                    state === 'closed' && 'cursor-not-allowed text-text-disabled line-through',
                    state === 'past' && 'cursor-not-allowed text-text-disabled',
                    isSelected && 'bg-primary font-semibold text-text-inverse',
                    isToday && !isSelected && 'ring-1 ring-inset ring-primary',
                  )}
                >
                  {Number(cell.key.slice(8))}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="mt-3 text-caption text-text-secondary">
        Struck-through dates are days you do not work. Earlier dates cannot be booked.
      </p>

      {error === undefined ? null : (
        <p id={errorId} className="mt-2 text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
