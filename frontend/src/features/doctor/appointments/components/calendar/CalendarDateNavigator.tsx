import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button, IconButton, Input } from '@/components/ui';
import { formatDateWith } from '@/i18n';

import type { AppointmentsView } from '../../hooks/useAppointmentListState';
import {
  addDays,
  addMonths,
  isValidDateKey,
  parseDateKey,
  startOfWeek,
  todayKey,
  type DateKey,
} from '../../model/calendar';

/**
 * ‹ Today › date navigator for the calendar views (UX 2.4). Steps by
 * day/week/month depending on the active view; the native date input is
 * the toolbar date picker (jump anywhere).
 */

const MONTH_LABEL: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const DAY_LABEL: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};
const SHORT_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

function rangeLabel(view: AppointmentsView, date: DateKey): string {
  if (view === 'month') return formatDateWith(parseDateKey(date), MONTH_LABEL);
  if (view === 'week') {
    const start = startOfWeek(date);
    return `${formatDateWith(parseDateKey(start), SHORT_DAY)} – ${formatDateWith(
      parseDateKey(addDays(start, 6)),
      SHORT_DAY,
    )}, ${String(parseDateKey(start).getFullYear())}`;
  }
  return formatDateWith(parseDateKey(date), DAY_LABEL);
}

export function CalendarDateNavigator({
  view,
  date,
  onDateChange,
}: {
  view: AppointmentsView;
  date: DateKey;
  onDateChange: (date: DateKey) => void;
}) {
  const step = (direction: 1 | -1) => {
    if (view === 'month') onDateChange(addMonths(date, direction));
    else if (view === 'week') onDateChange(addDays(date, direction * 7));
    else onDateChange(addDays(date, direction));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <IconButton
        icon={ChevronLeft}
        size="sm"
        aria-label="Previous period"
        onClick={() => step(-1)}
      />
      <Button variant="secondary" size="sm" onClick={() => onDateChange(todayKey())}>
        Today
      </Button>
      <IconButton icon={ChevronRight} size="sm" aria-label="Next period" onClick={() => step(1)} />
      <p aria-live="polite" className="min-w-0 text-body-sm font-semibold text-text-primary">
        {rangeLabel(view, date)}
      </p>
      <Input
        type="date"
        aria-label="Jump to date"
        value={date}
        onChange={(event) => {
          if (isValidDateKey(event.target.value)) onDateChange(event.target.value);
        }}
        containerClassName="w-40"
      />
    </div>
  );
}
