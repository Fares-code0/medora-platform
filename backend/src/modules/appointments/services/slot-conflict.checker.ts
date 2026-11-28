/**
 * ADR-005 §4's five rules, wired to the database (RM M11.2).
 *
 * `slot-conflict.ts` holds the arithmetic and knows nothing about
 * Prisma; this holds the queries and knows nothing about the arithmetic.
 * The split is what lets the boundary cases ADR-005 calls "the whole
 * risk" — a slot ending exactly at `end_time` is valid, one ending a
 * minute later is not — be tested without a database.
 *
 * ## The window the queries read
 *
 * Time off and existing bookings are fetched for a window around the
 * candidate rather than in full: `[start - buffer - longestDay,
 * end + buffer]`. The widening by a day's worth of minutes is what
 * catches an existing appointment that *starts* before the window and
 * runs into it — querying on `starts_at` alone would miss a 60-minute
 * booking at 09:30 when checking a 10:00 slot.
 *
 * ## Why this refuses rather than reports
 *
 * `assertBookable` throws the 409 instead of returning a conflict, for
 * the reason `PatientScopeService.assertCanReach` gives about itself: a
 * call site that ignores a returned value still runs the write it was
 * guarding, whereas one that ignores an exception does not exist.
 */

import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { isLockNotGranted } from '../../../shared/database';
import {
  AppointmentRepository,
  type ScheduleTx,
  type SchedulingRow,
} from '../repositories/appointment.repository';

import {
  findOccupancyConflict,
  findSlotConflict,
  type SlotCandidate,
  type SlotConflict,
} from './slot-conflict';

/**
 * How far back the booking query reaches, in minutes.
 *
 * An appointment cannot exceed a civil day (`staysWithinOneDay`), so a
 * day is the widest a pre-existing booking can reach forward into the
 * candidate's window. Reaching exactly that far is the cheap, correct
 * bound; narrowing it to "the longest appointment we have seen" would
 * be a guess that fails the first time someone books a longer one.
 */
const LOOKBACK_MINUTES = 24 * 60;

export interface BookabilityRequest {
  readonly doctorId: string;
  readonly scheduling: SchedulingRow;
  readonly timeZone: string;
  readonly candidate: SlotCandidate;
  /** The appointment being moved, which must not conflict with itself. */
  readonly excludeAppointmentId?: string | undefined;
  /** Set when checking one of several proposed slots, for the field path. */
  readonly slotIndex?: number | undefined;
  /**
   * The transaction holding the doctor's schedule lock (BE-1). A check
   * that guards a write must read inside it, or it can miss a booking
   * committed between the check and the write.
   */
  readonly tx?: ScheduleTx | undefined;
}

@Injectable()
export class SlotConflictChecker {
  constructor(private readonly appointments: AppointmentRepository) {}

  /**
   * Runs `work` holding the schedule lock of every doctor in
   * `doctorIds` — the transaction a guarded check and its write share
   * (BE-1; see `AppointmentRepository.withDoctorScheduleLock`).
   *
   * A lock wait that gives up (lock timeout, or a deadlock) becomes a
   * 503 that says only that the schedule is busy: no SQL, no lock
   * identity, no patient. Nothing was written, so the client may retry —
   * and an idempotency key is released on a failed request, so retrying
   * with the same key runs the booking again. There is no automatic
   * retry here.
   */
  async underScheduleLock<T>(
    doctorIds: readonly string[],
    work: (tx: ScheduleTx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.appointments.withDoctorScheduleLock(doctorIds, work);
    } catch (error) {
      if (isLockNotGranted(error)) throw scheduleBusy();
      throw error;
    }
  }

  /** Throws 409 naming the rule that refused; returns on a bookable slot. */
  async assertBookable(request: BookabilityRequest): Promise<void> {
    const { candidate, scheduling } = request;
    const { timeOff, booked } = await this.occupancyAround(request, scheduling.bufferMin);

    const conflict = findSlotConflict({
      candidate,
      timeZone: request.timeZone,
      bufferMin: scheduling.bufferMin,
      windows: scheduling.availability,
      timeOff,
      booked,
    });

    if (conflict === null) return;

    // A zero or negative duration is the body being wrong, not the book
    // being full — 422 with a field path, so the form can point at it.
    if (conflict.rule === 'duration') {
      throw AppException.validation({ durationMin: [conflict.detail] }, conflict.detail);
    }

    throw AppException.conflict(
      request.slotIndex === undefined
        ? conflict.detail
        : `Slot ${String(request.slotIndex + 1)}: ${conflict.detail}`,
      'slot_conflict',
    );
  }

  /**
   * The published-slot variant (DR-10): ADR-005 §4 rules 3–5 — time off,
   * other live appointments with the buffer, duration — without the
   * weekly grid (see `findOccupancyConflict`). Returns the conflict rather
   * than throwing, so the caller (slot publishing) chooses the answer:
   * `409 slot_conflict`.
   */
  async findOccupancy(request: OccupancyRequest): Promise<SlotConflict | null> {
    const { timeOff, booked } = await this.occupancyAround(request, request.bufferMin);

    return findOccupancyConflict({
      candidate: request.candidate,
      timeZone: request.timeZone,
      bufferMin: request.bufferMin,
      timeOff,
      booked,
    });
  }

  /** Time off and live bookings in the window a candidate could touch. */
  private async occupancyAround(
    request: {
      readonly doctorId: string;
      readonly candidate: SlotCandidate;
      readonly excludeAppointmentId?: string | undefined;
      readonly tx?: ScheduleTx | undefined;
    },
    bufferMin: number,
  ): Promise<{
    timeOff: readonly { startsAt: Date; endsAt: Date }[];
    booked: readonly { publicId: string; startsAt: Date; durationMin: number }[];
  }> {
    const bufferMs = Math.max(0, bufferMin) * 60_000;
    const start = request.candidate.startsAt.getTime();
    const end = start + Math.max(0, request.candidate.durationMin) * 60_000;

    const [timeOff, booked] = await Promise.all([
      this.appointments.timeOffOverlapping(
        request.doctorId,
        new Date(start - bufferMs),
        new Date(end + bufferMs),
        request.tx,
      ),
      this.appointments.bookedBetween(
        {
          doctorId: request.doctorId,
          from: new Date(start - bufferMs - LOOKBACK_MINUTES * 60_000),
          to: new Date(end + bufferMs),
          excludeId: request.excludeAppointmentId,
        },
        request.tx,
      ),
    ]);

    return { timeOff, booked };
  }
}

export interface OccupancyRequest {
  readonly doctorId: string;
  readonly bufferMin: number;
  readonly timeZone: string;
  readonly candidate: SlotCandidate;
  /** The transaction holding the doctor's schedule lock (BE-1). */
  readonly tx?: ScheduleTx | undefined;
}

function scheduleBusy(): AppException {
  return new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
    message: 'Service unavailable',
    code: 'service_unavailable',
    detail: "The doctor's schedule is being changed by another request. Try again.",
  });
}
