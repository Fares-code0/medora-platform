/**
 * The doctor's own schedule (RM M9.4 — API §3.8, §3.9).
 *
 * ## The overlap rules live here, and why they are not in the schema
 *
 * `@@unique([doctorId, weekday, startTime])` stops two rows starting at
 * the same minute and nothing more. Two windows that *overlap* —
 * 09:00–13:00 and 12:00–17:00 — satisfy it perfectly and describe a day
 * that books a patient into a slot twice. Postgres can express that as an
 * exclusion constraint over a range type; the schema does not, so the
 * rule is enforced here and the verify step for M9.4 ("overlapping ranges
 * rejected 422") is about this code.
 *
 * Three rules, all against the same day:
 *
 *  1. **Windows may not overlap each other.** Two working windows over
 *     one minute is a double booking waiting to be made.
 *  2. **Breaks may not overlap each other**, for the same reason read
 *     backwards — two breaks over one minute is an arithmetic error in
 *     whatever computes free capacity.
 *  3. **Every break must fall inside a working window.** A break outside
 *     the working day blocks nothing and, worse, makes the grid read as
 *     though it does.
 *
 * They are 422 with a field path rather than 409: the body is
 * internally inconsistent, which is a validation failure the editor can
 * point at a specific row.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import type { Weekday } from '../../../generated/prisma/enums';
import type {
  AvailabilityDay,
  AvailabilitySaveResult,
  AvailabilityView,
  ImpactedAppointment,
  TimeOffResult,
  TimeOffView,
  TimeRange,
} from '../dto/availability.dto';
import {
  WEEKDAYS,
  type AvailabilityUpdateInput,
  type TimeOffInput,
  type WeekdayWire,
} from '../dto/availability.schema';
import {
  AvailabilityRepository,
  type AvailabilityRow,
  type ImpactedAppointmentRow,
  type TimeOffRow,
} from '../repositories/availability.repository';

import { isKnownTimeZone, strandedBy } from './stranded-appointments';

/**
 * The zone used when the localization slice has none, or names one this
 * runtime cannot format in. UTC is what the seed writes and what the API
 * serves every instant in, so it is the reading that surprises least.
 */
const FALLBACK_TIMEZONE = 'UTC';

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly availability: AvailabilityRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  /** API §3.8 — the grid, always seven days whether open or not. */
  async grid(userId: string): Promise<AvailabilityView> {
    const doctor = await this.availability.schedulingFor(userId);
    if (doctor === null) throw notADoctor();

    return toView(
      doctor.availability,
      doctor.defaultDurationMin,
      doctor.bufferMin,
      await this.clinicTimezone(),
    );
  }

  /**
   * API §3.8 — replace the grid, and report the live appointments it no
   * longer covers (BR-DEC-005).
   *
   * The report is computed in the clinic's timezone — the only place it
   * can be exact, because the grid is a clinic-local wall clock. It is a
   * report and not a refusal: the save goes through and nothing is moved,
   * as DEC-005 requires of the client. Whether to refuse instead is a
   * policy the requirement leaves open, alongside RA-005.1.
   */
  async replaceGrid(
    user: AuthenticatedUser,
    input: AvailabilityUpdateInput,
  ): Promise<AvailabilitySaveResult> {
    const doctorId = await this.availability.doctorIdForUser(user.id);
    if (doctorId === null) throw notADoctor();

    assertConsistent(input.week);

    const rows = input.week.flatMap((day) => [
      ...day.windows.map((range) => toRow(day.weekday, range, false)),
      ...day.breaks.map((range) => toRow(day.weekday, range, true)),
    ]);

    await this.availability.replaceGrid({
      doctorId,
      actorId: user.id,
      rows,
      defaultDurationMin: input.defaultDurationMin,
      bufferMin: input.bufferMin,
    });

    const clinicTimezone = await this.clinicTimezone();
    const stranded = strandedBy(
      input.week,
      await this.availability.liveAppointmentsFrom(doctorId, new Date()),
      clinicTimezone,
    );

    await this.audit.record({
      action: 'doctor.availability_update',
      actor: { userId: user.id, role: user.role },
      entityType: 'doctor',
      entityId: doctorId,
      metadata: {
        openDays: input.week.filter((day) => day.open).length,
        defaultDurationMin: input.defaultDurationMin,
        bufferMin: input.bufferMin,
        // The count, as the time-off event records it — which patients is
        // the appointment trail's to say.
        stranded: stranded.length,
      },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'settings',
      summary: 'Updated the weekly availability',
    });

    const saved = await this.availability.schedulingFor(user.id);
    // The row was just written, so `saved` is non-null in every path a
    // caller can reach. Read back rather than echoed so the response is
    // the stored grid — ordering and all — instead of the request body.
    if (saved === null) throw notADoctor();

    return {
      ...toView(saved.availability, saved.defaultDurationMin, saved.bufferMin, clinicTimezone),
      stranded: stranded.map(toImpacted),
    };
  }

  /** The clinic's zone, or `FALLBACK_TIMEZONE` when it is unset or unusable. */
  private async clinicTimezone(): Promise<string> {
    const stored = await this.availability.clinicTimezone();

    return stored !== null && isKnownTimeZone(stored) ? stored : FALLBACK_TIMEZONE;
  }

  /** API §3.9 — the blocks that have not finished yet. */
  async timeOff(userId: string): Promise<readonly TimeOffView[]> {
    const doctorId = await this.availability.doctorIdForUser(userId);
    if (doctorId === null) throw notADoctor();

    return (await this.availability.upcomingTimeOff(doctorId)).map(toTimeOffView);
  }

  /**
   * API §3.9 — book a block and report what it would disturb.
   *
   * **No appointment is moved, whatever `mode` says.** ADR-005 RA-005.2
   * reads `reschedule-existing` as a pre-selection for the resolution
   * screen, never as automatic action, and §7's blast-radius
   * confirmation is mandatory. Returning the impact list and touching
   * nothing is the honest half of that; M11.5 owns the other half.
   */
  async createTimeOff(user: AuthenticatedUser, input: TimeOffInput): Promise<TimeOffResult> {
    const doctorId = await this.availability.doctorIdForUser(user.id);
    if (doctorId === null) throw notADoctor();

    const startsAt = new Date(input.from);
    const endsAt = new Date(input.to);

    const impacted = await this.availability.impactedAppointments(doctorId, startsAt, endsAt);

    const created = await this.availability.createTimeOff({
      doctorId,
      actorId: user.id,
      startsAt,
      endsAt,
      kind: input.kind,
      autoBehavior: input.mode,
    });

    await this.audit.record({
      action: 'doctor.time_off_create',
      actor: { userId: user.id, role: user.role },
      entityType: 'doctor_time_off',
      entityId: created.id,
      metadata: {
        kind: input.kind,
        mode: input.mode,
        // The count, not the appointments. An audit row records that a
        // block was booked and how much it touched; which patients were
        // affected is PHI-adjacent and belongs to the appointment trail.
        impacted: impacted.length,
      },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'settings',
      summary: input.kind === 'vacation' ? 'Booked time off' : 'Blocked emergency time',
      detail: `${String(impacted.length)} appointment(s) affected`,
    });

    return { timeOff: toTimeOffView(created), impacted: impacted.map(toImpacted) };
  }

  /** Cancels one of the caller's own blocks. */
  async removeTimeOff(user: AuthenticatedUser, timeOffId: string): Promise<void> {
    const doctorId = await this.availability.doctorIdForUser(user.id);
    if (doctorId === null) throw notADoctor();

    const removed = await this.availability.removeTimeOff(doctorId, timeOffId);
    // Another doctor's block and a non-existent one answer the same 404.
    if (removed === 0) throw AppException.notFound('Time off not found');

    await this.audit.record({
      action: 'doctor.time_off_delete',
      actor: { userId: user.id, role: user.role },
      entityType: 'doctor_time_off',
      entityId: timeOffId,
    });
  }
}

/**
 * 404, not 403, for a caller with no `doctors` row.
 *
 * An administrator or a patient hitting `/me/availability` has no
 * professional schedule — the resource genuinely does not exist for
 * them. A 403 would read as "you are not allowed to see your own
 * availability", which is a different and untrue statement.
 */
function notADoctor(): AppException {
  return AppException.notFound('No doctor profile for this account');
}

/** The three consistency rules, per day, as 422 field errors. */
function assertConsistent(week: AvailabilityUpdateInput['week']): void {
  const fieldErrors: Record<string, string[]> = {};

  for (const [index, day] of week.entries()) {
    if (overlaps(day.windows)) {
      (fieldErrors[`week[${String(index)}].windows`] ??= []).push(
        'Working windows on one day cannot overlap',
      );
    }

    if (overlaps(day.breaks)) {
      (fieldErrors[`week[${String(index)}].breaks`] ??= []).push('Breaks cannot overlap');
    }

    for (const [breakIndex, pause] of day.breaks.entries()) {
      const inside = day.windows.some(
        (window) => pause.start >= window.start && pause.end <= window.end,
      );
      if (inside) continue;

      (fieldErrors[`week[${String(index)}].breaks[${String(breakIndex)}]`] ??= []).push(
        'A break must fall inside a working window',
      );
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw AppException.validation(fieldErrors, 'The week is not internally consistent');
  }
}

/**
 * Whether any two ranges in a list share a minute.
 *
 * Sorted first, so the comparison is each range against its successor
 * rather than every pair — at six ranges a day the difference is
 * academic, but the sorted form is also the one a reader can check.
 * Touching endpoints are **not** an overlap: 09:00–12:00 and 12:00–17:00
 * is a lunch boundary, not a double booking.
 */
function overlaps(ranges: readonly TimeRange[]): boolean {
  const sorted = [...ranges].sort((left, right) => left.start.localeCompare(right.start));

  return sorted.some((range, index) => index > 0 && range.start < (sorted[index - 1]?.end ?? ''));
}

/**
 * `HH:MM` → a `Date` carrying only a time of day.
 *
 * The column is `time(0)`, which Prisma round-trips as a `Date` on the
 * Unix epoch. `1970-01-01T09:00:00Z` in UTC is what comes back as
 * `09:00`; building it from a local-time constructor would shift the
 * clinic's opening hours by the server's offset.
 */
function toRow(
  weekday: WeekdayWire,
  range: TimeRange,
  isBreak: boolean,
): { weekday: Weekday; startTime: Date; endTime: Date; isBreak: boolean } {
  return {
    weekday: WEEKDAY_FROM_WIRE[weekday],
    startTime: new Date(`1970-01-01T${range.start}:00.000Z`),
    endTime: new Date(`1970-01-01T${range.end}:00.000Z`),
    isBreak,
  };
}

function toClock(value: Date): string {
  return value.toISOString().slice(11, 16);
}

function toView(
  rows: readonly AvailabilityRow[],
  defaultDurationMin: number,
  bufferMin: number,
  clinicTimezone: string,
): AvailabilityView {
  const week: AvailabilityDay[] = WEEKDAYS.map((weekday) => {
    const forDay = rows.filter((row) => WEEKDAY_TO_WIRE[row.weekday] === weekday);
    const windows = forDay.filter((row) => !row.isBreak).map(toRange);
    const breaks = forDay.filter((row) => row.isBreak).map(toRange);

    return { weekday, open: windows.length > 0, windows, breaks };
  });

  return { week, defaultDurationMin, bufferMin, clinicTimezone };
}

function toRange(row: AvailabilityRow): TimeRange {
  return { start: toClock(row.startTime), end: toClock(row.endTime) };
}

function toTimeOffView(row: TimeOffRow): TimeOffView {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    kind: row.kind,
    autoBehavior: row.autoBehavior,
    createdAt: row.createdAt.toISOString(),
  };
}

function toImpacted(row: ImpactedAppointmentRow): ImpactedAppointment {
  return {
    id: row.publicId,
    scheduledAt: row.startsAt.toISOString(),
    durationMin: row.durationMin,
    status: APPOINTMENT_STATUS_WIRE[row.status] ?? row.status.toLowerCase(),
    // The handle, never the name. This list is rendered to the doctor
    // whose appointments they are, but it travels through a route that
    // is about their schedule rather than about their patients.
    patientId: row.patient.publicId,
  };
}

/**
 * Prisma member → wire value for the four statuses this list can carry.
 *
 * `modules/appointments` has the full eight-value map and M2.2's zone 1
 * forbids importing it. Four entries transcribed here rather than a
 * `.toLowerCase()` for the reason ADR-023 §2 gives: `NO_SHOW` is
 * `no-show` and `AWAITING_PATIENT` is `awaiting-patient`, so a mechanical
 * transform puts a value on the wire that no client vocabulary contains.
 * Only live statuses can reach this function — the repository filters —
 * but the map covers all eight so a widened filter cannot silently start
 * emitting `no_show`.
 */
const APPOINTMENT_STATUS_WIRE: Readonly<Record<string, string>> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  RESCHEDULED: 'rescheduled',
  NO_SHOW: 'no-show',
  AWAITING_PATIENT: 'awaiting-patient',
};

const WEEKDAY_FROM_WIRE: Record<WeekdayWire, Weekday> = {
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
  Sun: 'SUN',
};

const WEEKDAY_TO_WIRE: Record<Weekday, WeekdayWire> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
};
