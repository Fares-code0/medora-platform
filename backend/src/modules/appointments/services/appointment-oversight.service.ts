/**
 * Cross-doctor appointment oversight (RM M11.6 — API §5.10, UX §3.5).
 *
 * ## A different authorization decision, so a different service
 *
 * `AppointmentService` scopes every query by the caller's own
 * `doctors.id`. Nothing here does: an administrator investigating why a
 * request has sat unanswered for three days needs the platform's book,
 * not one doctor's. That is a genuinely different decision — guarded by
 * `appointments.reassign` and `appointments.cancelAdministratively`
 * rather than by `appointments.manageOwn` — and mixing the two into one
 * service behind a nullable `doctorId` is one forgotten argument away
 * from serving every doctor's book to whoever asked for their own.
 *
 * ## The patient stays masked
 *
 * API §0.4: admin patient projections are masked unless revealed. The
 * oversight row carries the `PT-…` handle and no identity fields at all
 * — see `toOversightView`. An administrator who needs a name elevates
 * through M7.3's audited reveal, which is a different path with a
 * different record.
 *
 * ## Intervening is audited, and says whose intervention it was
 *
 * Nudge, reassign and administrative cancel each write an
 * `appointment_events` row naming the administrator, plus an audit
 * event. An administrative cancellation that looked, in the history,
 * exactly like the doctor's own would make the trail useless at the
 * moment it matters.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type { AppointmentStatus } from '../../../generated/prisma/enums';
import { appointmentStatusToWire, STATUS_FROM_WIRE } from '../dto/appointment-enums';
import type {
  AppointmentAdminSummaryView,
  OversightAppointmentView,
} from '../dto/appointment.dto';
import type {
  AdministrativeCancelInput,
  NudgeInput,
  OversightListQuery,
  ReassignInput,
} from '../dto/appointment.schema';
import {
  AppointmentRepository,
  type BookRow,
  CrossHospitalReassignment,
  type ScheduleTx,
} from '../repositories/appointment.repository';

import { appointmentStatusMachine } from './appointment-status.machine';
import { CLINIC_TIMEZONE, type ClinicTimezoneSource } from './clinic-timezone';
import {
  REPEATED_RESCHEDULE_COUNT,
  STUCK_PENDING_HOURS,
  toOversightView,
} from './appointment-projection';
import { SlotConflictChecker } from './slot-conflict.checker';

export interface PaginatedOversight {
  readonly items: readonly OversightAppointmentView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

const DAY_MS = 86_400_000;

/**
 * ADM-05's nudge cooldown, in milliseconds.
 *
 * Sixty minutes, taken from the shipped admin UI rather than chosen
 * here — the two must agree, or the button enables itself an hour before
 * the server will accept the request.
 */
const NUDGE_COOLDOWN_MS = 60 * 60_000;

@Injectable()
export class AppointmentOversightService {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly conflicts: SlotConflictChecker,
    @Inject(CLINIC_TIMEZONE) private readonly timezone: ClinicTimezoneSource,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /**
   * API §5.10 — the cross-doctor table.
   *
   * `flag` filters after enrichment rather than in SQL, because both
   * flags are derived from the event trail: "stuck" is the age of the
   * *current status*, which lives in `appointment_events`, not in a
   * column on the appointment. Filtering in the database would mean
   * materialising that age, and a stored age is wrong one minute after
   * it is written — the same rule DB §14.5-6 states for queue waiting
   * times.
   *
   * The honest consequence is that a flag filter pages over the
   * unfiltered result, so `totalItems` describes the query and the
   * returned page describes the flag. `flaggedItems` is on the wire so
   * the client can say which number it is rendering rather than
   * guessing.
   */
  async list(query: OversightListQuery): Promise<PaginatedOversight & { flaggedItems: number }> {
    const { rows, totalItems } = await this.appointments.oversightList({
      from: query.from,
      to: query.to,
      status: query.status?.map((value) => STATUS_FROM_WIRE[value] as AppointmentStatus),
      doctorId: query.doctorId,
      department: query.department,
      q: query.q,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });

    const enriched = await this.enrich(rows);

    const filtered =
      query.flag === undefined
        ? enriched
        : enriched.filter((row) => matchesFlag(row, query.flag as string));

    const sorted =
      query.sort === 'stateSince:asc'
        ? [...filtered].sort((left, right) => left.stateSince.localeCompare(right.stateSince))
        : filtered;

    return {
      items: sorted,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
      flaggedItems: sorted.length,
    };
  }

  /** API §5.11's administrator strip. */
  async summary(): Promise<AppointmentAdminSummaryView> {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * DAY_MS);
    const [admin, doctorless] = await Promise.all([
      this.appointments.adminSummary({ weekStart, now }),
      this.appointments.platformCounts({ now }),
    ]);

    return {
      today: doctorless.today,
      pending: doctorless.pending,
      upcoming: doctorless.upcoming,
      completedThisWeek: doctorless.completedThisWeek,
      pendingOverDay: admin.pendingOverDay,
      // A fraction, never a pre-formatted percentage, and never a rate
      // quoted from an empty window: 0 appointments in seven days means
      // "no basis to quote a rate", which the denominator says out loud.
      cancellationRate7d: rate(admin.cancelled7d, admin.window7dTotal),
      noShowRate7d: rate(admin.noShow7d, admin.window7dTotal),
      window7dTotal: admin.window7dTotal,
    };
  }

  /**
   * API §5.10 — nudge.
   *
   * A nudge changes nothing about the appointment: it writes a `nudged`
   * event and publishes a reminder. So it is deliberately **not** a
   * transition and has no compare-and-set.
   *
   * ## The cooldown, and why the server owns it
   *
   * ADM-05 shipped a 60-minute nudge cooldown in the admin UI. A rule
   * that lives only in a button's disabled state is not a rule: a second
   * administrator on a second browser, or the same one after a reload,
   * sends the reminder anyway — and the person receiving three reminders
   * in ten minutes is the patient. So the server enforces it, from the
   * last `nudged` event on the row, and the UI's disabled button becomes
   * a courtesy rather than the control.
   */
  async nudge(
    user: AuthenticatedUser,
    publicId: string,
    input: NudgeInput,
  ): Promise<OversightAppointmentView> {
    const row = await this.require(publicId);

    // Only a row that is waiting on someone can be nudged. Nudging a
    // completed appointment would send a patient a reminder for a visit
    // they have already had.
    if (!['PENDING', 'AWAITING_PATIENT', 'SCHEDULED'].includes(row.status)) {
      throw AppException.conflict(
        `An appointment that is ${appointmentStatusToWire(row.status)} cannot be nudged`,
        'nudge_not_applicable',
      );
    }

    const lastNudge = (await this.appointments.oversightSignals([row.id]))[row.id]?.lastNudgedAt;
    const cooldownEndsAt =
      lastNudge === null || lastNudge === undefined
        ? null
        : new Date(lastNudge.getTime() + NUDGE_COOLDOWN_MS);

    if (cooldownEndsAt !== null && cooldownEndsAt > new Date()) {
      throw AppException.conflict(
        `This appointment was nudged less than ${String(
          NUDGE_COOLDOWN_MS / 60_000,
        )} minutes ago; the next reminder may be sent at ${cooldownEndsAt.toISOString()}`,
        'nudge_cooldown',
      );
    }

    await this.appointments.recordEvent({
      appointmentId: row.id,
      action: 'NUDGED',
      actorId: user.id,
      actorName: await this.actorName(user),
      reason: input.note ?? null,
      detail: { template: input.template },
    });

    await this.audit.record({
      action: 'appointment.nudge',
      actor: { userId: user.id, role: user.role },
      entityType: 'appointment',
      entityId: row.publicId,
      metadata: { template: input.template, status: appointmentStatusToWire(row.status) },
    });

    await this.outbox.publish({
      topic: 'appointment.nudged',
      payload: {
        appointmentId: row.publicId,
        patientId: row.patient.publicId,
        doctorId: row.doctor.id,
        template: input.template,
      },
      dedupeKey: `appointment.nudged:${row.publicId}:${new Date().toISOString()}`,
    });

    const [enriched] = await this.enrich([row]);
    if (enriched === undefined) throw notFound();

    return enriched;
  }

  /**
   * API §5.10 — reassign to another doctor of the same specialty.
   *
   * Three rules, all refused with a 409 that says which:
   *
   *  1. the receiving doctor must exist and must not be the current one;
   *  2. **same specialty** — the contract says so, and a cardiology
   *     follow-up handed to a dermatologist is a clinical error a
   *     scheduling tool must not be able to make;
   *  3. **live availability** — the receiving doctor's own grid must
   *     accept the slot, checked by the same five rules a fresh booking
   *     goes through. Reassigning into a slot the new doctor is not
   *     working is how an appointment silently becomes nobody's.
   *
   * The status is untouched: a reassignment moves the appointment
   * between doctors, it does not re-open a confirmed booking.
   */
  async reassign(
    user: AuthenticatedUser,
    publicId: string,
    input: ReassignInput,
  ): Promise<OversightAppointmentView> {
    const row = await this.require(publicId);

    if (appointmentStatusMachine.isTerminal(row.status)) {
      throw AppException.conflict(
        `An appointment that is ${appointmentStatusToWire(row.status)} cannot be reassigned`,
        'invalid_status_transition',
      );
    }

    if (input.doctorId === row.doctor.id) {
      throw AppException.conflict(
        'The appointment is already with that doctor',
        'reassign_no_change',
      );
    }

    const receiving = await this.appointments.doctorSummary(input.doctorId);
    if (receiving === null) {
      throw AppException.validation({ doctorId: ['Unknown doctor'] }, 'No such doctor');
    }

    if (receiving.specialty !== row.doctor.specialty) {
      // 422 with a field path rather than 409, per RM M11.6's verify
      // step: the appointment's state is fine and the request is
      // well-formed — it is *this value* of `doctorId` that is not a
      // valid target, and the picker needs a field to highlight.
      throw AppException.validation(
        { doctorId: ['The receiving doctor is in a different specialty'] },
        'The receiving doctor is in a different specialty',
        'specialty_mismatch',
      );
    }

    const timeZone = await this.timezone.current();
    const actorName = await this.actorName(user);

    // BE-1: the receiving doctor gains an occupied interval, so the check
    // and the move hold that doctor's schedule lock — and the current
    // doctor's, because a reschedule by them could otherwise move the
    // slot between this check and the write, landing the appointment on
    // the receiving doctor at a time nobody checked. Both are locked in
    // one statement in id order, and the row is read again under them.
    const moved = await this.conflicts
      .underScheduleLock([row.doctor.id, receiving.id], async (tx) => {
        const locked = await this.appointments.findAny(publicId, tx);
        if (locked === null) throw notFound();

        if (
          locked.doctor.id !== row.doctor.id ||
          appointmentStatusMachine.isTerminal(locked.status)
        ) {
          return null;
        }

        await this.assertReceivingDoctorIsFree(receiving.id, locked, timeZone, tx);

        return this.appointments.reassignTo(
          {
            appointmentId: locked.id,
            fromDoctorId: locked.doctor.id,
            toDoctorId: receiving.id,
            actorId: user.id,
            actorName,
            reason: input.reason,
          },
          tx,
        );
      })
      .catch((error: unknown) => {
        // F-07: an appointment belongs to its hospital for good. A doctor
        // who does not practise there cannot receive it; the booking is
        // cancelled and the patient rebooked at the other hospital.
        if (error instanceof CrossHospitalReassignment) {
          throw AppException.validation(
            { doctorId: ['The receiving doctor does not practise at this appointment’s hospital'] },
            'Reassignment cannot cross hospitals; cancel and rebook instead',
            'cross_hospital_reassignment',
          );
        }
        throw error;
      });

    if (moved === null) {
      throw AppException.conflict(
        'The appointment changed while this request was in flight; reload and try again',
        'stale_write',
      );
    }

    await this.audit.record({
      action: 'appointment.reassign',
      actor: { userId: user.id, role: user.role },
      entityType: 'appointment',
      entityId: row.publicId,
      metadata: { fromDoctorId: row.doctor.id, toDoctorId: receiving.id },
    });

    // Both parties, per the contract. Two messages rather than one with
    // two recipients, so a failure to reach one is visible as its own
    // delivery row when M19's channels land.
    for (const recipient of ['patient', 'receiving-doctor'] as const) {
      await this.outbox.publish({
        topic: 'appointment.reassigned',
        payload: {
          appointmentId: row.publicId,
          patientId: row.patient.publicId,
          fromDoctorId: row.doctor.id,
          toDoctorId: receiving.id,
          recipient,
        },
        dedupeKey: `appointment.reassigned:${row.publicId}:${receiving.id}:${recipient}`,
      });
    }

    const [enriched] = await this.enrich([moved]);
    if (enriched === undefined) throw notFound();

    return enriched;
  }

  /**
   * API §5.10 — administrative cancellation.
   *
   * The same transition an ordinary cancel makes, through the same
   * machine, with a category the doctor's own cancel does not have. The
   * distinction lives in the event's `detail` and in the audit action —
   * `appointment.cancel_administratively` — so the trail says who
   * overrode whom.
   */
  async cancelAdministratively(
    user: AuthenticatedUser,
    publicId: string,
    input: AdministrativeCancelInput,
  ): Promise<OversightAppointmentView> {
    const row = await this.require(publicId);

    appointmentStatusMachine.assert(row.status, 'CANCELLED');

    const result = await this.appointments.transition({
      appointmentId: row.id,
      from: row.status,
      to: 'CANCELLED',
      action: 'CANCEL',
      actorId: user.id,
      actorName: await this.actorName(user),
      reason: input.reason,
      cancelledReason: input.reason,
      detail: { administrative: true, category: input.category },
    });

    if (result === null) {
      throw AppException.conflict(
        'The appointment changed while this request was in flight; reload and try again',
        'stale_write',
      );
    }

    await this.appointments.expireProposals(row.id);

    await this.audit.record({
      action: 'appointment.cancel_administratively',
      actor: { userId: user.id, role: user.role },
      entityType: 'appointment',
      entityId: row.publicId,
      metadata: { category: input.category, previousStatus: appointmentStatusToWire(row.status) },
    });

    for (const recipient of ['patient', 'doctor'] as const) {
      await this.outbox.publish({
        topic: 'appointment.cancelled_administratively',
        payload: {
          appointmentId: row.publicId,
          patientId: row.patient.publicId,
          doctorId: row.doctor.id,
          category: input.category,
          recipient,
        },
        dedupeKey: `appointment.cancelled_administratively:${row.publicId}:${recipient}`,
      });
    }

    const [enriched] = await this.enrich([result.row]);
    if (enriched === undefined) throw notFound();

    return enriched;
  }

  /** Rule 3 of `reassign` — the receiving doctor's grid must accept the slot. */
  private async assertReceivingDoctorIsFree(
    doctorId: string,
    row: BookRow,
    timeZone: string,
    tx: ScheduleTx,
  ): Promise<void> {
    const scheduling = await this.appointments.schedulingFor(doctorId, tx);
    if (scheduling === null) {
      throw AppException.validation({ doctorId: ['Unknown doctor'] }, 'No such doctor');
    }

    await this.conflicts.assertBookable({
      doctorId,
      scheduling,
      timeZone,
      candidate: { startsAt: row.startsAt, durationMin: row.durationMin },
      excludeAppointmentId: row.id,
      tx,
    });
  }

  private async require(publicId: string): Promise<BookRow> {
    const row = await this.appointments.findAny(publicId);
    if (row === null) throw notFound();

    return row;
  }

  private async actorName(user: AuthenticatedUser): Promise<string> {
    return (await this.appointments.displayNameForUser(user.id)) ?? user.publicId;
  }

  private async enrich(rows: readonly BookRow[]): Promise<readonly OversightAppointmentView[]> {
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const [transitions, signals] = await Promise.all([
      this.appointments.lastTransitionAt(ids),
      this.appointments.oversightSignals(ids),
    ]);

    const now = new Date();

    return rows.map((row) =>
      toOversightView(
        row,
        {
          // Falls back to the booking's own creation: a row that has
          // never transitioned has been in its current status since it
          // was created, which is exactly what age-in-state means.
          stateSince: transitions[row.id] ?? row.createdAt,
          reschedules: signals[row.id]?.reschedules ?? 0,
          lastNudgedAt: signals[row.id]?.lastNudgedAt ?? null,
        },
        now,
      ),
    );
  }
}

function matchesFlag(row: OversightAppointmentView, flag: string): boolean {
  switch (flag) {
    case 'stuck-pending':
      return row.status === 'pending' && row.ageInStateHours >= STUCK_PENDING_HOURS;
    case 'repeated-reschedules':
      return row.rescheduleCount >= REPEATED_RESCHEDULE_COUNT;
    default:
      // `complaint` is API §5.10's third flag and has no source of truth
      // yet: complaints are M20.7's safety-flag queue, which is not
      // built. Answering "no rows" is the honest response — inventing a
      // heuristic would put rows in front of an administrator as
      // complaints when nobody complained.
      return false;
  }
}

/** A fraction in `[0, 1]` to four places, or 0 when there is no denominator. */
function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;

  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function notFound(): AppException {
  return AppException.notFound('Appointment not found');
}
