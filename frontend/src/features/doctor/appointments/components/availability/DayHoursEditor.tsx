import { Plus, Trash2 } from 'lucide-react';

import { Button, IconButton, Input, Switch } from '@/components/ui';

import {
  MAX_RANGES_PER_DAY,
  WEEKDAY_LABELS,
  type AvailabilityDay,
  type TimeRange,
} from '../../model/availability';

/**
 * One day of the weekly grid (DEC-005): open or closed, its working windows
 * and its breaks. Closing a day clears its hours, because the server
 * refuses a closed day that carries any; opening one starts it with a single
 * window for the doctor to adjust, since an open day needs at least one.
 */

const NEW_WINDOW: TimeRange = { start: '09:00', end: '17:00' };
const NEW_BREAK: TimeRange = { start: '12:00', end: '13:00' };

interface DayHoursEditorProps {
  readonly day: AvailabilityDay;
  readonly errors: readonly string[] | undefined;
  readonly disabled: boolean;
  readonly onChange: (next: AvailabilityDay) => void;
}

export function DayHoursEditor({ day, errors, disabled, onChange }: DayHoursEditorProps) {
  const label = WEEKDAY_LABELS[day.weekday];
  const errorId = `availability-${day.weekday}-errors`;
  const invalid = errors !== undefined && errors.length > 0;

  return (
    <li
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
      aria-describedby={invalid ? errorId : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Switch
          checked={day.open}
          label={label}
          description={day.open ? undefined : 'Closed'}
          disabled={disabled}
          onCheckedChange={(open) =>
            onChange(
              open
                ? { ...day, open, windows: day.windows.length > 0 ? day.windows : [NEW_WINDOW] }
                : { ...day, open, windows: [], breaks: [] },
            )
          }
        />
      </div>

      {day.open ? (
        <div className="flex flex-col gap-3 ps-1 sm:ps-12">
          <RangeList
            dayLabel={label}
            noun="Window"
            ranges={day.windows}
            fallback={NEW_WINDOW}
            disabled={disabled}
            onChange={(windows) => onChange({ ...day, windows })}
          />
          <RangeList
            dayLabel={label}
            noun="Break"
            ranges={day.breaks}
            fallback={NEW_BREAK}
            disabled={disabled}
            onChange={(breaks) => onChange({ ...day, breaks })}
          />
        </div>
      ) : null}

      {invalid ? (
        <ul id={errorId} className="flex flex-col gap-0.5 ps-1 text-body-sm text-error sm:ps-12">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function RangeList({
  dayLabel,
  noun,
  ranges,
  fallback,
  disabled,
  onChange,
}: {
  readonly dayLabel: string;
  readonly noun: 'Window' | 'Break';
  readonly ranges: readonly TimeRange[];
  readonly fallback: TimeRange;
  readonly disabled: boolean;
  readonly onChange: (next: readonly TimeRange[]) => void;
}) {
  const plural = noun === 'Window' ? 'Working hours' : 'Breaks';
  const update = (index: number, patch: Partial<TimeRange>) =>
    onChange(ranges.map((range, at) => (at === index ? { ...range, ...patch } : range)));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption font-medium text-text-secondary">{plural}</p>
      {ranges.length === 0 ? (
        <p className="text-body-sm text-text-tertiary">No {plural.toLowerCase()}.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranges.map((range, index) => {
            const name = `${dayLabel} ${noun.toLowerCase()} ${String(index + 1)}`;
            return (
              <li
                key={index}
                // A grid below `sm`, so each range's Remove stays on the
                // row it removes instead of wrapping under both times.
                className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap"
              >
                <Input
                  type="time"
                  aria-label={`${name} start`}
                  value={range.start}
                  disabled={disabled}
                  onChange={(event) => update(index, { start: event.target.value })}
                  containerClassName="w-full sm:w-32"
                  // At 375px a field is ~105px: on a coarse pointer the
                  // picker opens on tap, so its icon goes and "PM" is not
                  // clipped to "P" (an AM/PM ambiguity in a clinic schedule).
                  className="touch:px-2 touch:[&::-webkit-calendar-picker-indicator]:hidden"
                />
                <span aria-hidden="true" className="text-text-tertiary">
                  –
                </span>
                <Input
                  type="time"
                  aria-label={`${name} end`}
                  value={range.end}
                  disabled={disabled}
                  onChange={(event) => update(index, { end: event.target.value })}
                  containerClassName="w-full sm:w-32"
                  // At 375px a field is ~105px: on a coarse pointer the
                  // picker opens on tap, so its icon goes and "PM" is not
                  // clipped to "P" (an AM/PM ambiguity in a clinic schedule).
                  className="touch:px-2 touch:[&::-webkit-calendar-picker-indicator]:hidden"
                />
                <IconButton
                  icon={Trash2}
                  aria-label={`Remove ${name}`}
                  disabled={disabled}
                  onClick={() => onChange(ranges.filter((_, at) => at !== index))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={Plus}
          disabled={disabled || ranges.length >= MAX_RANGES_PER_DAY}
          onClick={() => onChange([...ranges, fallback])}
          aria-label={`Add ${noun.toLowerCase()} to ${dayLabel}`}
        >
          Add {noun.toLowerCase()}
        </Button>
      </div>
    </div>
  );
}
