import { useState } from 'react';

import { CalendarClock, Timer } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Alert, ErrorState, Skeleton } from '@/components/feedback';
import { Button, ConfirmationDialog, Input, Select } from '@/components/ui';
import { isolateLtr } from '@/i18n';
import { isApiError } from '@/types/api';

import {
  useAvailabilityQuery,
  useFreshAppointmentsFetcher,
  useReplaceAvailabilityMutation,
} from '../../api/useAppointmentsQuery';
import {
  BUFFER_MAX,
  BUFFER_MIN,
  SLOT_DURATIONS,
  WEEKDAY_LABELS,
  errorsFromFieldErrors,
  hasErrors,
  rowsFromPreview,
  rowsFromReport,
  sameAvailability,
  strandedAppointments,
  validateWeek,
  zoneOrDevice,
  type StrandedRow,
  type WeekErrors,
  type WeeklyAvailability,
} from '../../model/availability';
import type { Appointment } from '../../model/types';

import { DayHoursEditor } from './DayHoursEditor';
import { StrandedAppointmentsList } from './StrandedAppointmentsList';

/**
 * Weekly availability (DEC-005) — the doctor's working hours, breaks,
 * default appointment length and buffer, against `GET`/`PUT
 * /me/availability`. Mounted in the doctor's Settings by the settings page.
 *
 * Saving is two steps. The week is first checked against the server's
 * rules, then against the doctor's upcoming appointments: the review lists
 * every live booking the new hours would no longer cover, links each to its
 * Reschedule action, and says plainly that saving moves none of them. When
 * the book cannot be read, the review says the check did not run rather
 * than reporting nothing affected.
 *
 * BR-DEC-005: the comparison is made in the clinic's timezone, which the
 * server now serves; and every save answers with the server's own list of
 * appointments the saved week strands. After the save that report — not the
 * preview — is what the editor shows, because it is exact. A server that
 * makes no report leaves the preview's result on screen, as before.
 */

const NO_ERRORS: WeekErrors = { days: {} };

type Review =
  | {
      readonly kind: 'checked';
      readonly rows: readonly StrandedRow[];
      /** The book the preview read — names for the server's report. */
      readonly book: readonly Appointment[];
    }
  | { readonly kind: 'unchecked' };

/** What the last save left behind, kept on screen until dismissed. */
type Aftermath =
  | {
      readonly kind: 'checked';
      readonly rows: readonly StrandedRow[];
      /** True when the rows are the server's report rather than the preview's. */
      readonly reported: boolean;
    }
  | { readonly kind: 'unchecked' }
  | null;

const DURATION_OPTIONS = SLOT_DURATIONS.map((minutes) => ({
  value: String(minutes),
  label: isolateLtr(`${String(minutes)} minutes`),
}));

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'this device’s time zone';
  }
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function AvailabilitySection() {
  const query = useAvailabilityQuery();

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        title="Couldn't load your working hours"
        headingLevel="h2"
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <AvailabilityEditor saved={query.data} />;
}

function AvailabilityEditor({ saved }: { readonly saved: WeeklyAvailability }) {
  const { toast } = useToast();
  const fetchAppointments = useFreshAppointmentsFetcher();
  const mutation = useReplaceAvailabilityMutation();

  const [draft, setDraft] = useState<WeeklyAvailability | null>(null);
  const [errors, setErrors] = useState<WeekErrors>(NO_ERRORS);
  const [general, setGeneral] = useState<readonly string[]>([]);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [aftermath, setAftermath] = useState<Aftermath>(null);

  const week = draft ?? saved;
  // The zone the grid is read in: the clinic's when the server says, and
  // this runtime can use it; otherwise the device's, disclosed in the review.
  const clinicZone = zoneOrDevice(saved.clinicTimezone);
  const dirty = draft !== null && !sameAvailability(draft, saved);
  const busy = checking || mutation.isPending;
  const invalidDays = Object.entries(errors.days).filter(([, list]) => list.length > 0).length;

  function edit(next: WeeklyAvailability) {
    setDraft(next);
    // Errors describe the week they were found in; an edit may fix them.
    // They are recomputed on the next save attempt.
    if (hasErrors(errors) || general.length > 0) {
      setErrors(NO_ERRORS);
      setGeneral([]);
    }
  }

  function discard() {
    setDraft(null);
    setErrors(NO_ERRORS);
    setGeneral([]);
  }

  async function startReview() {
    if (draft === null) return;
    const found = validateWeek(draft);
    setErrors(found);
    setGeneral([]);
    if (hasErrors(found)) return;

    setChecking(true);
    try {
      const appointments = await fetchAppointments();
      setReview({
        kind: 'checked',
        rows: rowsFromPreview(
          strandedAppointments(appointments, saved.week, draft.week, new Date(), clinicZone),
        ),
        book: appointments,
      });
    } catch {
      setReview({ kind: 'unchecked' });
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    if (draft === null || review === null) return;
    try {
      const result = await mutation.mutateAsync(draft);
      setDraft(null);
      setAftermath(aftermathOf(review, result.stranded, saved, result.saved, clinicZone));
      setReview(null);
      toast({ variant: 'success', title: 'Working hours saved' });
    } catch (error) {
      setReview(null);
      if (isApiError(error) && error.kind === 'validation') {
        const mapped = errorsFromFieldErrors(draft.week, error.fieldErrors);
        setErrors(mapped);
        setGeneral(mapped.general);
        toast({
          variant: 'error',
          title: 'The server refused these hours',
          description: 'Nothing was saved. The days it named are marked below.',
        });
        return;
      }
      toast({
        variant: 'error',
        title: "Couldn't save your working hours",
        description: 'Nothing was saved. Please try again.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Alert variant="info" title="How these hours are used">
        Patients and staff can book you only inside these hours, outside your breaks. Changing them
        never moves, cancels or notifies an existing appointment. Clinic opening hours are not
        checked here: no clinic-hours policy or data is available to this app yet.
      </Alert>

      {aftermath !== null ? (
        <Alert
          variant="warning"
          title={
            aftermath.kind === 'checked'
              ? `${String(aftermath.rows.length)} upcoming ${plural(
                  aftermath.rows.length,
                  'appointment is',
                  'appointments are',
                )} still booked outside your hours`
              : 'Your upcoming appointments were not checked against these hours'
          }
          onDismiss={() => setAftermath(null)}
        >
          {aftermath.kind === 'checked' ? (
            <div className="mt-2 flex flex-col gap-2">
              <p>
                {aftermath.reported
                  ? 'The server checked the saved hours against your book in the clinic’s time zone and found these. '
                  : ''}
                Saving did not change them. Reschedule or cancel each one that needs it.
              </p>
              <StrandedAppointmentsList rows={aftermath.rows} clinicZone={clinicZone} />
            </div>
          ) : (
            'Your appointment list could not be read when you saved. Check your upcoming appointments for any that now fall outside your hours.'
          )}
        </Alert>
      ) : null}

      <section className="rounded-surface border border-border bg-surface px-5 py-4">
        <h3 className="mb-3 flex items-center gap-2 text-h5 font-semibold text-text-primary">
          <Timer aria-hidden="true" className="h-4 w-4 text-text-secondary" />
          Appointment length
        </h3>
        <div className="flex flex-wrap gap-4">
          <Select
            label="Default appointment length"
            options={DURATION_OPTIONS}
            value={String(week.defaultDurationMin)}
            error={errors.defaultDurationMin}
            disabled={busy}
            onChange={(value) => edit({ ...week, defaultDurationMin: Number(value) })}
            containerClassName="w-56"
          />
          <Input
            type="number"
            label="Buffer between appointments (minutes)"
            min={BUFFER_MIN}
            max={BUFFER_MAX}
            step={1}
            inputMode="numeric"
            value={Number.isNaN(week.bufferMin) ? '' : String(week.bufferMin)}
            error={errors.bufferMin}
            disabled={busy}
            onChange={(event) =>
              edit({
                ...week,
                bufferMin: event.target.value === '' ? Number.NaN : Number(event.target.value),
              })
            }
            containerClassName="w-72"
          />
        </div>
      </section>

      <section className="rounded-surface border border-border bg-surface px-5 py-4">
        <h3 className="mb-1 flex items-center gap-2 text-h5 font-semibold text-text-primary">
          <CalendarClock aria-hidden="true" className="h-4 w-4 text-text-secondary" />
          Weekly hours
        </h3>
        <p className="mb-4 text-body-sm text-text-secondary">
          Times are the clinic’s local time. Up to six working windows and six breaks a day; every
          break must sit inside a working window.
        </p>

        {invalidDays > 0 || general.length > 0 ? (
          <div role="alert" className="mb-4">
            <Alert variant="error" title="These hours can't be saved yet">
              {invalidDays > 0
                ? `Fix the ${invalidDays === 1 ? 'day' : `${String(invalidDays)} days`} marked below: ${Object.keys(
                    errors.days,
                  )
                    .map((day) => WEEKDAY_LABELS[day as keyof typeof WEEKDAY_LABELS])
                    .join(', ')}.`
                : null}
              {general.length > 0 ? ` ${general.join(' ')}` : null}
            </Alert>
          </div>
        ) : null}

        <ul className="flex flex-col divide-y divide-border">
          {week.week.map((day, index) => (
            <DayHoursEditor
              key={day.weekday}
              day={day}
              errors={errors.days[day.weekday]}
              disabled={busy}
              onChange={(next) =>
                edit({ ...week, week: week.week.map((other, at) => (at === index ? next : other)) })
              }
            />
          ))}
        </ul>
      </section>

      {dirty ? (
        <div className="sticky bottom-0 z-sticky flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-surface-overlay px-4 py-3 shadow-modal">
          <p className="text-body-sm font-medium text-text-secondary">
            Unsaved changes to your working hours
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={discard} disabled={busy}>
              Discard
            </Button>
            <Button size="sm" onClick={() => void startReview()} loading={checking} disabled={busy}>
              Review and save
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmationDialog
        open={review !== null}
        onClose={() => {
          if (!mutation.isPending) setReview(null);
        }}
        onConfirm={() => void save()}
        loading={mutation.isPending}
        title="Save your working hours?"
        confirmLabel={
          review?.kind === 'checked' && review.rows.length === 0
            ? 'Save hours'
            : review?.kind === 'checked'
              ? 'Save hours anyway'
              : 'Save without checking'
        }
        tone="primary"
      >
        {review !== null ? <ReviewBody review={review} clinicZone={clinicZone} /> : null}
      </ConfirmationDialog>
    </div>
  );
}

/**
 * What stays on screen after a save. The server's report wins when there is
 * one: it is computed where the comparison is exact, and an empty report
 * means nothing is stranded even if the preview thought otherwise. Without a
 * report the preview's result stands, as it did before BR-DEC-005.
 */
function aftermathOf(
  review: Review,
  report: Parameters<typeof rowsFromReport>[0] | null,
  previous: WeeklyAvailability,
  stored: WeeklyAvailability,
  clinicZone: string | null,
): Aftermath {
  if (report !== null) {
    if (report.length === 0) return null;
    const book = review.kind === 'checked' ? review.book : [];
    return {
      kind: 'checked',
      rows: rowsFromReport(report, book, previous.week, stored.week, clinicZone),
      reported: true,
    };
  }
  if (review.kind === 'unchecked') return review;
  return review.rows.length === 0 ? null : { kind: 'checked', rows: review.rows, reported: false };
}

function ReviewBody({
  review,
  clinicZone,
}: {
  readonly review: Review;
  readonly clinicZone: string | null;
}) {
  const caveat =
    clinicZone === null ? (
      <p className="text-caption text-text-secondary">
        Appointment times were compared in {deviceTimeZone()}. The server applies working hours in
        the clinic’s time zone, which it has not shared with this app; if the two differ, this check
        can be wrong.
      </p>
    ) : (
      <p className="text-caption text-text-secondary">
        Appointment times were compared in the clinic’s time zone, {clinicZone}. The server checks
        your book again when you save and lists any appointment the saved hours leave uncovered.
      </p>
    );

  if (review.kind === 'unchecked') {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="warning" title="Your upcoming appointments couldn't be checked">
          Your appointment list could not be read, so this can’t tell you whether any booked
          appointment falls outside the new hours. Saving will not move or cancel any of them.
        </Alert>
      </div>
    );
  }

  if (review.rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-text-primary">
          No upcoming appointment falls outside these hours.
        </p>
        {caveat}
      </div>
    );
  }

  const count = review.rows.length;
  return (
    <div className="flex flex-col gap-3">
      <Alert
        variant="warning"
        title={`${String(count)} upcoming ${count === 1 ? 'appointment falls' : 'appointments fall'} outside these hours`}
      >
        Saving does not move, cancel or notify anyone about {count === 1 ? 'it' : 'them'}.{' '}
        {count === 1 ? 'It stays' : 'They stay'} booked until you reschedule or cancel{' '}
        {count === 1 ? 'it' : 'each one'}.
      </Alert>
      <StrandedAppointmentsList rows={review.rows} clinicZone={clinicZone} />
      {caveat}
    </div>
  );
}
