/**
 * Emergency time-off resolution (RM M11.5 — API §5.9, ADR-005 §7).
 *
 * ## The two phases, and why the split is the safety property
 *
 * `POST /me/time-off` (M9.4) creates the block and **returns** the
 * appointments it would disturb. It sends nothing. This endpoint is the
 * second phase: the doctor has seen the list, chosen what to do, and
 * echoes back the count they were shown.
 *
 * `confirmedCount` is the whole mechanism. If the server's current
 * impact count differs from the number the doctor confirmed, the list
 * changed under them — a patient booked into the window while the
 * confirmation dialog was open — and acting would notify people the
 * doctor never saw. So it is a 409 and **nothing is sent**. RM M11.5's
 * verify step tests exactly that: "nothing sent before confirmation
 * (outbox empty)".
 *
 * ## Three resolutions, one of which deliberately does nothing to the row
 *
 *  - `cancel-apology` — cancels each appointment with the block's reason
 *    and notifies the patient. Destructive and audited.
 *  - `reschedule-proposal` — moves each to `awaiting-patient`, which is
 *    what "propose another time" means when it is issued in bulk: the
 *    patient is told their slot is gone and asked to pick again. The
 *    per-appointment slot list is API §5.8's endpoint, one at a time, by
 *    choice — three slots that suit one patient do not suit thirty.
 *
 *    **This reaches fewer appointments than it appears to, and the gap
 *    is deliberate.** ADR-001 permits `awaiting-patient` only from
 *    `pending`; RA-001.1 records that no source enumerates the wider
 *    origin set and instructs the conservative reading until product
 *    confirms it, and the M5.10 trigger encodes the same restriction. So
 *    a `scheduled` or `confirmed` appointment inside an emergency block
 *    is reported in `skipped`, naming the transition that was refused,
 *    rather than forced through a matrix two accepted decisions and a
 *    database trigger all refuse. Widening it is a one-line change to
 *    the machine's table and a migration — see RA-001.1 and RM M11.5's
 *    residual note. Until then the doctor's route for those rows is
 *    `cancel-apology`, or §5.8 per appointment.
 *  - `handover` — notifies without changing status. The appointment
 *    stays as it is until an administrator reassigns it through §5.10,
 *    because choosing the receiving doctor is a clinical judgement this
 *    endpoint has no basis to make.
 *
 * ## Partial failure is reported, not swallowed
 *
 * Each appointment is resolved in its own transaction, and the response
 * carries `resolved` and `skipped` separately. One appointment that lost
 * a compare-and-set must not roll back the other twenty-nine, and must
 * not be silently counted as done.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type { AppointmentStatus } from '../../../generated/prisma/enums';
import { appointmentStatusToWire } from '../dto/appointment-enums';
import type { ResolveTimeOffInput } from '../dto/appointment.schema';
import { AppointmentRepository, type BookRow } from '../repositories/appointment.repository';

import { appointmentStatusMachine } from './appointment-status.machine';

export interface TimeOffResolutionResult {
  readonly action: string;
  /** References that moved, in the order they were processed. */
  readonly resolved: readonly string[];
  /** References that did not, each with the reason it was left alone. */
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
  readonly notified: number;
}

@Injectable()
export class TimeOffResolutionService {
  constructor(
    private readonly appointments: AppointmentRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async resolve(
    user: AuthenticatedUser,
    timeOffId: string,
    input: ResolveTimeOffInput,
  ): Promise<TimeOffResolutionResult> {
    const doctorId = await this.appointments.doctorIdForUser(user.id);
    if (doctorId === null) throw AppException.notFound('No doctor profile for this account');

    const block = await this.appointments.timeOffFor(doctorId, timeOffId);
    // Another doctor's block and a non-existent one answer the same 404.
    if (block === null) throw AppException.notFound('Time off not found');

    const impacted = await this.appointments.impactedByTimeOff(
      doctorId,
      block.startsAt,
      block.endsAt,
    );

    // The blast-radius gate, before a single message is built.
    if (impacted.length !== input.confirmedCount) {
      throw AppException.conflict(
        `The impact list changed: ${String(impacted.length)} appointment(s) are affected, ` +
          `not ${String(input.confirmedCount)}. Reload and confirm again.`,
        'blast_radius_changed',
      );
    }

    const selected =
      input.appointmentIds === undefined || input.appointmentIds.length === 0
        ? impacted
        : impacted.filter((row) => input.appointmentIds?.includes(row.publicId) === true);

    const actorName = (await this.appointments.displayNameForUser(user.id)) ?? user.publicId;
    const reason = input.reason ?? 'The doctor is unavailable at this time';

    const resolved: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const row of selected) {
      const outcome = await this.applyTo({
        row,
        action: input.action,
        actorId: user.id,
        actorName,
        reason,
      });

      if (outcome === null) resolved.push(row.publicId);
      else skipped.push({ id: row.publicId, reason: outcome });
    }

    await this.audit.record({
      action: 'appointment.time_off_resolve',
      actor: { userId: user.id, role: user.role },
      entityType: 'doctor_time_off',
      entityId: timeOffId,
      metadata: {
        resolution: input.action,
        confirmedCount: input.confirmedCount,
        resolved: resolved.length,
        skipped: skipped.length,
      },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'profile',
      summary: 'Resolved the impact of a time-off block',
      detail: `${String(resolved.length)} appointment(s) ${input.action}`,
    });

    return { action: input.action, resolved, skipped, notified: resolved.length };
  }

  /** `null` on success, or the reason this appointment was left alone. */
  private async applyTo(input: {
    readonly row: BookRow;
    readonly action: ResolveTimeOffInput['action'];
    readonly actorId: string;
    readonly actorName: string;
    readonly reason: string;
  }): Promise<string | null> {
    const { row } = input;

    // `handover` changes nothing about the row — it announces that the
    // slot needs another doctor. The event is still written, so the
    // history says the doctor acted rather than leaving a silent gap.
    if (input.action === 'handover') {
      await this.appointments.recordEvent({
        appointmentId: row.id,
        action: 'NUDGED',
        actorId: input.actorId,
        actorName: input.actorName,
        reason: input.reason,
        detail: { resolution: 'handover' },
      });

      await this.publish('appointment.handover_requested', row, input.action);

      return null;
    }

    const target: AppointmentStatus =
      input.action === 'cancel-apology' ? 'CANCELLED' : 'AWAITING_PATIENT';

    if (!appointmentStatusMachine.can(row.status, target)) {
      // Reported, never forced. See the header: this is ADR-001
      // RA-001.1's open question surfacing, not a defect in the caller's
      // request, and the reason names the transition so the doctor can
      // see which rows need a different resolution.
      return (
        `${appointmentStatusToWire(row.status)} cannot become ` +
        `${appointmentStatusToWire(target)}`
      );
    }

    const result = await this.appointments.transition({
      appointmentId: row.id,
      from: row.status,
      to: target,
      action: target === 'CANCELLED' ? 'CANCEL' : 'RESCHEDULE',
      actorId: input.actorId,
      actorName: input.actorName,
      reason: input.reason,
      detail: { resolution: input.action },
      ...(target === 'CANCELLED' ? { cancelledReason: input.reason } : {}),
    });

    // Lost the compare-and-set: someone moved this row between the
    // impact list and the write. Reported, never retried — the doctor
    // confirmed a list that no longer describes this appointment.
    if (result === null) return 'changed while the resolution was in flight';

    await this.publish(
      target === 'CANCELLED' ? 'appointment.cancelled' : 'appointment.slots_requested',
      result.row,
      input.action,
    );

    return null;
  }

  private async publish(topic: string, row: BookRow, resolution: string): Promise<void> {
    await this.outbox.publish({
      topic,
      payload: {
        appointmentId: row.publicId,
        patientId: row.patient.publicId,
        doctorId: row.doctor.id,
        resolution,
      },
      dedupeKey: `${topic}:${row.publicId}:${row.updatedAt.toISOString()}`,
    });
  }
}
