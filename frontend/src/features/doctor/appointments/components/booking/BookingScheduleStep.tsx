import { useEffect, useRef, useState } from 'react';

import { Link } from 'react-router-dom';

import { Alert, ErrorState, Skeleton } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Select } from '@/components/ui';
import { isolateLtr } from '@/i18n';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import type { BookingScheduleState } from '../../hooks/useBookingSchedule';
import { WEEKDAY_LABELS, type AvailabilityDay } from '../../model/availability';
import {
  BOOKING_DURATIONS,
  SLOT_STATE_LABELS,
  hasWorkingHours,
  type BookingFailure,
  type BookingIssues,
} from '../../model/booking';
import type { DateKey } from '../../model/calendar';

import { BookingCalendar } from './BookingCalendar';

/**
 * Step 2 — Date & time.
 *
 * A calendar of the clinic's dates, the doctor's weekly hours, and the day's
 * slots for the chosen duration. A slot is disabled only for a reason the
 * server would also refuse it for (or because it is already past), and says
 * which; everything else is offered, and the server checks it on booking.
 *
 * The slot grid is a native radio group: one choice, arrow keys move it, and
 * a disabled radio is skipped — no custom keyboard handling to get wrong.
 */
export interface BookingScheduleStepProps {
  readonly scheduling: BookingScheduleState;
  readonly date: DateKey | null;
  readonly time: string | null;
  readonly durationMin: number;
  readonly onDateChange: (date: DateKey) => void;
  readonly onTimeChange: (time: string) => void;
  readonly onDurationChange: (durationMin: number) => void;
  /** The chosen time stopped being bookable (duration changed, the book refreshed). */
  readonly onTimeInvalidated: () => void;
  readonly issues: BookingIssues;
  /** The server's last refusal of a time, shown here until another time is chosen. */
  readonly failure: Extract<BookingFailure, { kind: 'slot' }> | null;
}

function rangesLabel(day: AvailabilityDay): string {
  const windows = day.windows.map((range) => `${range.start}–${range.end}`).join(', ');
  const breaks = day.breaks.map((range) => `${range.start}–${range.end}`).join(', ');
  return breaks === '' ? windows : `${windows} · break ${breaks}`;
}

export function BookingScheduleStep({
  scheduling,
  date,
  time,
  durationMin,
  onDateChange,
  onTimeChange,
  onDurationChange,
  onTimeInvalidated,
  issues,
  failure,
}: BookingScheduleStepProps) {
  const { availability, schedule, timeZone, today, occupancyFailed } = scheduling;

  /*
   * A chosen time that stops being bookable — a longer duration no longer
   * fits before a break, or the refreshed book shows it taken — is cleared,
   * and the doctor is told which time and why, rather than left holding a
   * selection the server would refuse.
   */
  const [lostTime, setLostTime] = useState<string | null>(null);
  const selectedState =
    time === null || schedule === null
      ? null
      : (schedule.slots.find((slot) => slot.time === time)?.state ?? 'gone');
  useEffect(() => {
    if (time === null || selectedState === null || selectedState === 'available') return;
    setLostTime(time);
    onTimeInvalidated();
  }, [time, selectedState, onTimeInvalidated]);

  /* The refusal takes focus, so a screen reader hears it on arrival. */
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failure !== null) failureRef.current?.focus();
  }, [failure]);

  const zoneNote =
    timeZone === null
      ? "Times are in this device's time zone — the server did not report the clinic's."
      : `Times are in the clinic's time zone (${timeZone}).`;

  return (
    <Stack gap={5}>
      {failure === null ? null : (
        <div ref={failureRef} tabIndex={-1} className="outline-none">
          <Alert variant="error" title={failure.title}>
            <p>{failure.message}</p>
            <p className="mt-1 text-caption">
              {failure.serverDetail === null
                ? null
                : `${
                    failure.refusedTime === null
                      ? 'The server said'
                      : `The server refused ${failure.refusedTime}`
                  }: “${failure.serverDetail}”. `}
              Your other details are kept.
            </p>
          </Alert>
        </div>
      )}

      <p className="text-caption text-text-secondary">{zoneNote}</p>

      {availability.isPending ? (
        <div
          className="grid gap-6 lg:grid-cols-2"
          aria-busy="true"
          aria-label="Loading your working hours"
        >
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : availability.isError ? (
        <ErrorState
          title="Couldn't load your working hours"
          error={availability.error}
          onRetry={() => void availability.refetch()}
        />
      ) : !hasWorkingHours(availability.data) ? (
        <Alert variant="warning" title="You have no working hours set">
          The server books only inside your working hours, so there is no time to offer yet.{' '}
          <Link
            className="font-medium text-primary underline"
            to={routes.doctor.settings('availability')}
          >
            Set your working hours
          </Link>
          .
        </Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Stack gap={4}>
            <BookingCalendar
              selected={date}
              onSelect={(next) => {
                setLostTime(null);
                onDateChange(next);
              }}
              availability={availability.data}
              today={today}
              error={issues.date}
            />

            <section aria-labelledby="booking-hours-heading">
              <h3
                id="booking-hours-heading"
                className="text-body-sm font-semibold text-text-primary"
              >
                Your working hours
              </h3>
              <dl className="mt-2 divide-y divide-border rounded-surface border border-border">
                {availability.data.week.map((day) => {
                  const current = schedule?.weekday === day.weekday;
                  const open = day.open && day.windows.length > 0;
                  return (
                    <div
                      key={day.weekday}
                      className={cn(
                        'flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-body-sm',
                        current && 'bg-primary-subtle',
                      )}
                    >
                      <dt
                        className={cn(
                          'font-medium',
                          open ? 'text-text-primary' : 'text-text-tertiary',
                        )}
                      >
                        {WEEKDAY_LABELS[day.weekday]}
                        {current ? <span className="sr-only"> (selected day)</span> : null}
                      </dt>
                      <dd
                        className={cn(
                          'tabular-nums',
                          open ? 'text-text-secondary' : 'text-text-tertiary',
                        )}
                      >
                        {open ? isolateLtr(rangesLabel(day)) : 'Not working'}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          </Stack>

          <Stack gap={4}>
            <Select
              label="Duration"
              required
              value={String(durationMin)}
              onChange={(value) => onDurationChange(Number(value))}
              options={BOOKING_DURATIONS.map((value) => ({
                value: String(value),
                label: isolateLtr(`${String(value)} min`),
              }))}
              helperText="Only times where the whole visit fits your hours are offered."
              error={issues.duration}
              containerClassName="max-w-xs"
            />

            {lostTime === null || time !== null ? null : (
              <Alert variant="warning" title={`${lostTime} is no longer available`}>
                It is no longer open for a {String(durationMin)}-minute visit on this day. Choose
                another time.
              </Alert>
            )}

            {occupancyFailed ? (
              <Alert variant="warning" title="Existing bookings could not be checked">
                Times are offered by your working hours only. The server checks your appointments
                and time off when you confirm.
              </Alert>
            ) : null}

            {date === null ? (
              <p className="rounded-surface border border-dashed border-border p-6 text-center text-body-sm text-text-secondary">
                Choose a date to see its available times.
              </p>
            ) : schedule === null ? null : schedule.hours === null ? (
              <p className="rounded-surface border border-dashed border-border p-6 text-center text-body-sm text-text-secondary">
                You do not work on {WEEKDAY_LABELS[schedule.weekday]}s. Choose another date.
              </p>
            ) : (
              <fieldset
                aria-describedby={issues.time === undefined ? undefined : 'booking-time-error'}
              >
                <legend className="text-body-sm font-semibold text-text-primary">
                  Available times
                  <span aria-hidden="true" className="text-error">
                    {' '}
                    *
                  </span>
                </legend>
                <p className="mt-0.5 text-caption text-text-secondary">
                  {isolateLtr(`${rangesLabel(schedule.hours)}`)} ·{' '}
                  {String(schedule.slots.filter((slot) => slot.state === 'available').length)} of{' '}
                  {String(schedule.slots.length)} times open
                </p>

                {schedule.slots.length === 0 ||
                schedule.slots.every((slot) => slot.state !== 'available') ? (
                  <p className="mt-3 text-body-sm text-text-secondary" role="status">
                    No open times on this day for a {String(durationMin)}-minute visit. Choose
                    another date or a shorter duration.
                  </p>
                ) : null}

                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
                  {schedule.slots.map((slot) => {
                    const available = slot.state === 'available';
                    const checked = slot.time === time;
                    return (
                      <label
                        key={slot.time}
                        className={cn('block', !available && 'cursor-not-allowed')}
                      >
                        <input
                          type="radio"
                          name="booking-time"
                          className="peer sr-only"
                          value={slot.time}
                          checked={checked}
                          disabled={!available}
                          onChange={() => {
                            setLostTime(null);
                            onTimeChange(slot.time);
                          }}
                          aria-label={`${slot.time} to ${slot.endTime}${available ? '' : ` — ${SLOT_STATE_LABELS[slot.state].toLowerCase()}`}`}
                        />
                        <span
                          className={cn(
                            'flex min-h-11 flex-col items-center justify-center rounded-control border px-2 py-1.5 text-center',
                            'transition-colors duration-fast',
                            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
                            available &&
                              !checked &&
                              'cursor-pointer border-border-strong bg-surface text-text-primary hover:border-primary hover:bg-primary-subtle',
                            checked && 'border-primary bg-primary text-text-inverse',
                            !available && 'border-border bg-surface-sunken text-text-disabled',
                          )}
                        >
                          <span className="text-body-sm font-semibold tabular-nums">
                            {slot.time}
                          </span>
                          <span className="text-caption">
                            {available ? `until ${slot.endTime}` : SLOT_STATE_LABELS[slot.state]}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {issues.time === undefined ? null : (
                  <p id="booking-time-error" className="mt-2 text-body-sm text-error" role="alert">
                    {issues.time}
                  </p>
                )}
              </fieldset>
            )}
          </Stack>
        </div>
      )}
    </Stack>
  );
}
