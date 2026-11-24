/**
 * The doctor's appointment book (RM M11.1–M11.4 — API §5).
 *
 * ## Three rules this module is built around
 *
 * **1. The doctor scope is in the query, the care scope is asserted.**
 * Reads are scoped by `doctorId` in the WHERE clause, so an appointment
 * that is not the caller's answers 404 without ever being loaded.
 * Booking additionally goes through `PatientScopeService.assertCanReach`
 * — RM M7.2's standing obligation on every clinical route — because
 * creating an appointment is a write against a patient's chart, and
 * holding `appointments.manageOwn` is not a care relationship.
 *
 * **2. Every transition is compare-and-set, and every one writes an
 * event.** The repository does both in one statement and one
 * transaction. This service's job is to decide *whether* the transition
 * is legal (the ADR-001 machine), *whether* the clock permits it
 * (`assertSlotDateArrived`), and what the history row should say.
 *
 * **3. Notifications are published after commit, never during.** API §5
 * is explicit: "notifications only after commit (outbox)". Every
 * `publish` in this file is sequenced after the transaction it
 * describes has returned, so a rolled-back approval cannot send a
 * patient a confirmation for an appointment that does not exist.
 *
 * ## Why the clinic timezone is resolved once per request
 *
 * `slotDateHasArrived` and the conflict rules both need it, and it is a
 * settings row. Reading it once at the top of each handler and threading
 * it down keeps a single request internally consistent — a handler that
 * read it twice could, in principle, straddle an operator's edit and
 * apply two different definitions of "today" to one decision.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PatientScopeService, principalOf, type ClinicalEmployment } from '../../../shared/authz';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type { AppointmentPriority, AppointmentStatus } from '../../../generated/prisma/enums';
import {
  appointmentPriorityToWire,
  appointmentStatusToWire,
  PRIORITY_FROM_WIRE,
  STATUS_FROM_WIRE,
} from '../dto/appointment-enums';
import type {
  AppointmentDetailView,
  AppointmentSummaryView,
  AppointmentView,
} from '../dto/appointment.dto';
import type {
  AppointmentListQuery,
  CancelAppointmentInput,
  CreateAppointmentInput,
  ProposeSlotsInput,
  RejectAppointmentInput,
  RescheduleAppointmentInput,
} from '../dto/appointment.schema';
import { AppointmentRepository, type BookRow } from '../repositories/appointment.repository';

import { assertSlotDateArrived, appointmentStatusMachine } from './appointment-status.machine';
import { civilDate, civilMoment } from './clinic-calendar';
import { CLINIC_TIMEZONE, type ClinicTimezoneSource } from './clinic-timezone';
import { toDetailView, toView } from './appointment-projection';
import { SlotConflictChecker } from './slot-conflict.checker';

export interface PaginatedAppointments {
  readonly items: readonly AppointmentView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

/** One day in milliseconds — the calendar-window arithmetic. */
const DAY_MS = 86_400_000;

@Injectable()
export class AppointmentService {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly conflicts: SlotConflictChecker,
    private readonly scope: PatientScopeService,
    @Inject(CLINIC_TIMEZONE) private readonly timezone: ClinicTimezoneSource,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /** API §5.1 — the book, in list or calendar form. */
  async list(user: AuthenticatedUser, query: AppointmentListQuery): Promise<PaginatedAppointments> {
    const doctor = await this.requireDoctor(user);
    const [timeZone, window] = await Promise.all([
      this.timezone.current(),
      Promise.resolve(calendarWindow(query)),
    ]);

    const { rows, totalItems } = await this.appointments.list(doctor, {
      from: window.from,
      to: window.to,
      status: query.status?.map((value) => STATUS_FROM_WIRE[value] as AppointmentStatus),
      priority: query.priority?.map((value) => PRIORITY_FROM_WIRE[value] as AppointmentPriority),
      visitType: query.visitType,
      department: query.department,
      q: query.q,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
      paginate: query.view === 'list',
    });

    const now = new Date();

    return {
      items: rows.map((row) => toView(row, timeZone, now)),
      page: query.view === 'list' ? query.page : 1,
      pageSize: query.view === 'list' ? query.pageSize : rows.length,
      totalItems,
      totalPages:
        query.view === 'list' ? Math.ceil(totalItems / query.pageSize) : rows.length === 0 ? 0 : 1,
    };
  }

  /** API §5.2 — one appointment with its full history. */
  async detail(user: AuthenticatedUser, publicId: string): Promise<AppointmentDetailView> {
    const doctor = await this.requireDoctor(user);
    const row = await this.appointments.findForDoctor(doctor, publicId);
    if (row === null) throw notFound();

    return toDetailView(row, await this.timezone.current(), new Date());
  }

  /**
   * API §5.3 — book an appointment.
   *
   * Status `scheduled`, per the contract. A doctor booking into their
   * own book is not requesting anything of themselves, so `pending` —
   * which means "awaiting the doctor's answer" — would be the wrong
   * initial state and would put the row in the action queue of the
   * person who just created it.
   */
  async create(user: AuthenticatedUser, input: CreateAppointmentInput): Promise<AppointmentView> {
    const doctor = await this.requireDoctor(user);
    const doctorId = doctor.doctorId;

    // The care relationship, before anything is resolved or written. Its
    // scope is where the booking lives (S4): the active hospital, the
    // patient's medical record there and the doctor's active employment.
    const scope = await this.scope.assertCanReach(principalOf(user), input.patientId);

    const patient = await this.appointments.patientByPublicId(input.patientId);
    // Unreachable in practice — `assertCanReach` already 404s for a
    // patient that does not exist — but the compiler does not know that
    // and neither should a later reader.
    if (patient === null) throw notFound('Patient not found');

    const scheduling = await this.appointments.schedulingFor(doctorId);
    if (scheduling === null) throw notADoctor();

    const visitTypeId = await this.appointments.visitTypeIdByName(input.visitType);
    if (visitTypeId === null) {
      throw AppException.validation(
        { visitType: ['Unknown visit type'] },
        'The visit type is not one this clinic offers',
      );
    }

    const departmentId =
      input.department === undefined
        ? await this.appointments.defaultDepartmentId(doctorId)
        : await this.resolveDepartment(input.department);

    const durationMin = input.durationMin ?? scheduling.defaultDurationMin;
    const timeZone = await this.timezone.current();
    const actorName = await this.actorName(user);

    // BE-1: the check and the insert hold the doctor's schedule lock
    // together, so a concurrent booking for this doctor either committed
    // before the check (and is seen by it) or waits until this commits.
    const created = await this.conflicts.underScheduleLock([doctorId], async (tx) => {
      const current = (await this.appointments.schedulingFor(doctorId, tx)) ?? scheduling;

      await this.conflicts.assertBookable({
        doctorId,
        scheduling: current,
        timeZone,
        candidate: { startsAt: input.dateTime, durationMin },
        tx,
      });

      return this.appointments.create(
        {
          publicId: await this.appointments.nextReference(tx),
          scope,
          departmentId,
          visitTypeId,
          startsAt: input.dateTime,
          durationMin,
          status: 'SCHEDULED',
          priority: PRIORITY_FROM_WIRE[input.priority] ?? 'NORMAL',
          reason: input.reason,
          notes: input.notes ?? null,
          isNewPatient: input.isNewPatient,
          isFollowUp: input.isFollowUp,
          actorId: user.id,
          actorName,
        },
        tx,
      );
    });

    await this.afterWrite({
      user,
      row: created,
      action: 'appointment.create',
      topic: 'appointment.created',
      summary: 'Booked an appointment',
    });

    return toView(created, timeZone, new Date());
  }

  /** API §5.4 — approve a pending request. */
  approve(user: AuthenticatedUser, publicId: string): Promise<AppointmentView> {
    return this.move({
      user,
      publicId,
      to: 'CONFIRMED',
      action: 'APPROVE',
      auditAction: 'appointment.approve',
      topic: 'appointment.confirmed',
      summary: 'Approved an appointment request',
      reason: null,
    });
  }

  /** API §5.5 — reject a pending request. P4: category required. */
  reject(
    user: AuthenticatedUser,
    publicId: string,
    input: RejectAppointmentInput,
  ): Promise<AppointmentView> {
    const reason = input.reason ?? categoryLabel(input.reasonCategory);

    return this.move({
      user,
      publicId,
      to: 'CANCELLED',
      action: 'REJECT',
      auditAction: 'appointment.reject',
      topic: 'appointment.rejected',
      summary: 'Rejected an appointment request',
      reason,
      cancelledReason: reason,
      detail: { reasonCategory: input.reasonCategory },
      metadata: { reasonCategory: input.reasonCategory },
    });
  }

  /** API §5.7 — cancel. P4: the reason is mandatory. */
  cancel(
    user: AuthenticatedUser,
    publicId: string,
    input: CancelAppointmentInput,
  ): Promise<AppointmentView> {
    return this.move({
      user,
      publicId,
      to: 'CANCELLED',
      action: 'CANCEL',
      auditAction: 'appointment.cancel',
      topic: 'appointment.cancelled',
      summary: 'Cancelled an appointment',
      reason: input.reason,
      cancelledReason: input.reason,
    });
  }

  /** API §5.7 — mark completed. Only once the slot date has arrived. */
  complete(user: AuthenticatedUser, publicId: string): Promise<AppointmentView> {
    return this.move({
      user,
      publicId,
      to: 'COMPLETED',
      action: 'COMPLETE',
      auditAction: 'appointment.complete',
      topic: 'appointment.completed',
      summary: 'Completed an appointment',
      reason: null,
    });
  }

  /** API §5.7 — mark no-show. Same clock gate as completion. */
  noShow(user: AuthenticatedUser, publicId: string): Promise<AppointmentView> {
    return this.move({
      user,
      publicId,
      to: 'NO_SHOW',
      action: 'NO_SHOW',
      auditAction: 'appointment.no_show',
      topic: 'appointment.no_show',
      summary: 'Marked an appointment as a no-show',
      reason: null,
    });
  }

  /**
   * API §5.6 — move an appointment to a new slot.
   *
   * The new slot is conflict-checked against the doctor's grid exactly
   * as a fresh booking is, excluding the appointment being moved — a
   * reschedule that landed on top of another patient would be a double
   * booking created by the very endpoint meant to resolve one.
   */
  async reschedule(
    user: AuthenticatedUser,
    publicId: string,
    input: RescheduleAppointmentInput,
  ): Promise<AppointmentView> {
    const doctor = await this.requireDoctor(user);
    const doctorId = doctor.doctorId;
    const current = await this.appointments.findForDoctor(doctor, publicId);
    if (current === null) throw notFound();

    const scheduling = await this.appointments.schedulingFor(doctorId);
    if (scheduling === null) throw notADoctor();

    const timeZone = await this.timezone.current();

    appointmentStatusMachine.assert(current.status, 'RESCHEDULED');

    const actorName = await this.actorName(user);

    // BE-1: check and move under the doctor's schedule lock. The row is
    // read again inside it, so the status the compare-and-set expects and
    // the slot being vacated are the ones that are true now — not as of
    // the read above, which another request may have overtaken.
    const { result, previous } = await this.conflicts.underScheduleLock([doctorId], async (tx) => {
      const locked = await this.appointments.findForDoctor(doctor, publicId, tx);
      if (locked === null) throw notFound();
      appointmentStatusMachine.assert(locked.status, 'RESCHEDULED');

      const durationMin = input.durationMin ?? locked.durationMin;

      await this.conflicts.assertBookable({
        doctorId,
        scheduling: (await this.appointments.schedulingFor(doctorId, tx)) ?? scheduling,
        timeZone,
        candidate: { startsAt: input.dateTime, durationMin },
        excludeAppointmentId: locked.id,
        tx,
      });

      const moved = await this.appointments.transition(
        {
          appointmentId: locked.id,
          from: locked.status,
          to: 'RESCHEDULED',
          action: 'RESCHEDULE',
          actorId: user.id,
          actorName,
          reason: input.reason,
          detail: {
            previousStartsAt: locked.startsAt.toISOString(),
            startsAt: input.dateTime.toISOString(),
            durationMin,
          },
          startsAt: input.dateTime,
          durationMin,
        },
        tx,
      );

      return { result: moved, previous: locked };
    });

    if (result === null) throw staleWrite();

    // A slot that has moved invalidates any proposal the patient is
    // still looking at.
    await this.appointments.expireProposals(previous.id);

    await this.afterWrite({
      user,
      row: result.row,
      action: 'appointment.reschedule',
      topic: 'appointment.rescheduled',
      summary: 'Rescheduled an appointment',
      metadata: { previousStartsAt: previous.startsAt.toISOString() },
    });

    return toView(result.row, timeZone, new Date());
  }

  /**
   * API §5.8 — propose up to three alternative times.
   *
   * **Only from `pending`.** ADR-001 RA-001.1 records that no source
   * enumerates the origin states for this transition and instructs the
   * safe reading: accept it from the one state where the contract's own
   * flow is unambiguous — a patient request the doctor cannot
   * accommodate — and widen it once product confirms. The machine's
   * table is where that widening happens, and it is one line.
   */
  async proposeSlots(
    user: AuthenticatedUser,
    publicId: string,
    input: ProposeSlotsInput,
  ): Promise<AppointmentDetailView> {
    const doctor = await this.requireDoctor(user);
    const doctorId = doctor.doctorId;
    const current = await this.appointments.findForDoctor(doctor, publicId);
    if (current === null) throw notFound();

    appointmentStatusMachine.assert(current.status, 'AWAITING_PATIENT');

    const scheduling = await this.appointments.schedulingFor(doctorId);
    if (scheduling === null) throw notADoctor();

    const timeZone = await this.timezone.current();

    // Every proposed slot is checked before any of them is offered. A
    // proposal the patient accepts and the server then refuses is the
    // worst possible outcome of this endpoint — the patient has been
    // told a time that was never available.
    for (const [index, slot] of input.slots.entries()) {
      await this.conflicts.assertBookable({
        doctorId,
        scheduling,
        timeZone,
        candidate: { startsAt: slot, durationMin: current.durationMin },
        excludeAppointmentId: current.id,
        slotIndex: index,
      });
    }

    const result = await this.appointments.transition({
      appointmentId: current.id,
      from: current.status,
      to: 'AWAITING_PATIENT',
      action: 'RESCHEDULE',
      actorId: user.id,
      actorName: await this.actorName(user),
      reason: input.reason ?? null,
      detail: { slots: input.slots.map((slot) => slot.toISOString()) },
    });

    if (result === null) throw staleWrite();

    await this.appointments.createProposal({
      appointmentId: current.id,
      proposedBy: user.id,
      slots: input.slots,
    });

    await this.afterWrite({
      user,
      row: result.row,
      action: 'appointment.propose_slots',
      topic: 'appointment.slots_proposed',
      summary: 'Proposed alternative appointment times',
      metadata: { slots: input.slots.length },
    });

    const refreshed = await this.appointments.findForDoctor(doctor, publicId);
    if (refreshed === null) throw notFound();

    return toDetailView(refreshed, timeZone, new Date());
  }

  /** API §5.11 — the cards above the book. */
  async summary(user: AuthenticatedUser): Promise<AppointmentSummaryView> {
    const doctor = await this.requireDoctor(user);
    const now = new Date();
    const bounds = clinicDayBounds(await this.timezone.current(), now);

    return this.appointments.summaryFor(doctor, bounds);
  }

  /**
   * The shared body of every status action.
   *
   * Written once because the sequence is identical for all six and the
   * *order* is the part that matters: resolve the row, ask the machine,
   * ask the clock, compare-and-set, then — and only then — audit and
   * publish. Six copies of that would be six chances to publish before
   * the commit.
   */
  private async move(input: {
    readonly user: AuthenticatedUser;
    readonly publicId: string;
    readonly to: AppointmentStatus;
    readonly action: 'APPROVE' | 'REJECT' | 'CANCEL' | 'COMPLETE' | 'NO_SHOW';
    readonly auditAction: string;
    readonly topic: string;
    readonly summary: string;
    readonly reason: string | null;
    readonly cancelledReason?: string;
    readonly detail?: Readonly<Record<string, unknown>>;
    readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  }): Promise<AppointmentView> {
    const doctor = await this.requireDoctor(input.user);
    const current = await this.appointments.findForDoctor(doctor, input.publicId);
    if (current === null) throw notFound();

    const timeZone = await this.timezone.current();
    const now = new Date();

    appointmentStatusMachine.assert(current.status, input.to);
    assertSlotDateArrived(input.to, current.startsAt, timeZone, now);

    const result = await this.appointments.transition({
      appointmentId: current.id,
      from: current.status,
      to: input.to,
      action: input.action,
      actorId: input.user.id,
      actorName: await this.actorName(input.user),
      reason: input.reason,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      ...(input.cancelledReason === undefined ? {} : { cancelledReason: input.cancelledReason }),
    });

    if (result === null) throw staleWrite();

    if (appointmentStatusMachine.isTerminal(input.to)) {
      await this.appointments.expireProposals(current.id);
    }

    await this.afterWrite({
      user: input.user,
      row: result.row,
      action: input.auditAction,
      topic: input.topic,
      summary: input.summary,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });

    return toView(result.row, timeZone, now);
  }

  /**
   * Audit, activity and the outbox — in that order, after the commit.
   *
   * The audit row records *that* the appointment moved and carries no
   * clinical content: the reference and the status, never the patient's
   * name or the reason text a clinician typed (MG §11.6).
   */
  private async afterWrite(input: {
    readonly user: AuthenticatedUser;
    readonly row: BookRow;
    readonly action: string;
    readonly topic: string;
    readonly summary: string;
    readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  }): Promise<void> {
    await this.audit.record({
      action: input.action,
      actor: { userId: input.user.id, role: input.user.role },
      entityType: 'appointment',
      entityId: input.row.publicId,
      metadata: {
        status: appointmentStatusToWire(input.row.status),
        priority: appointmentPriorityToWire(input.row.priority),
        ...input.metadata,
      },
    });

    await this.activity.record({
      userId: input.user.id,
      kind: 'profile',
      summary: input.summary,
      detail: input.row.publicId,
    });

    await this.outbox.publish({
      topic: input.topic,
      payload: {
        appointmentId: input.row.publicId,
        patientId: input.row.patient.publicId,
        doctorId: input.row.doctor.id,
        startsAt: input.row.startsAt.toISOString(),
        status: appointmentStatusToWire(input.row.status),
      },
      dedupeKey: `${input.topic}:${input.row.publicId}:${input.row.updatedAt.toISOString()}`,
    });
  }

  /**
   * The display name to snapshot onto the history row (ADR-003 §4).
   *
   * Read from `users` per mutation rather than carried on the token: the
   * token is minted at login and a name changed since then would write a
   * stale snapshot, which is the one thing a snapshot must not be. It
   * falls back to the public id so an event row always names *someone* —
   * an unattributed transition is a defect, not a system action.
   */
  private async actorName(user: AuthenticatedUser): Promise<string> {
    return (await this.appointments.displayNameForUser(user.id)) ?? user.publicId;
  }

  /**
   * The doctor's clinical employment (S3/S4): the book a doctor reads and
   * writes is the active hospital's. No profile, no active employment, or
   * an unverified, suspended or deleted doctor (#18, OD-12) fail closed.
   * Schedule conflicts still use the doctor's id: a doctor's time is one
   * timeline whichever hospital a booking belongs to.
   */
  private async requireDoctor(user: AuthenticatedUser): Promise<ClinicalEmployment> {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));
    if (doctor === null) throw notADoctor();

    return doctor;
  }

  private async resolveDepartment(name: string): Promise<string> {
    const id = await this.appointments.departmentIdByName(name);
    if (id !== null) return id;

    throw AppException.validation(
      { department: ['Unknown department'] },
      'The department is not one this clinic runs',
    );
  }
}

/**
 * A human sentence for a rejection whose body carried only a category.
 *
 * `reason` is optional on API §5.5, and `appointment_events.reason` is
 * what the history renders — a blank line there would make a rejection
 * look unexplained when it was in fact categorised.
 */
function categoryLabel(category: string): string {
  switch (category) {
    case 'schedule_conflict':
      return 'Schedule conflict';
    case 'outside_specialty':
      return 'Outside this specialty';
    case 'insufficient_information':
      return 'Insufficient information';
    case 'patient_unreachable':
      return 'Patient unreachable';
    default:
      return 'Rejected by the clinic';
  }
}

/**
 * The clinic's "today" and "this week", as instants.
 *
 * The civil date is resolved in the clinic's zone and then turned back
 * into an instant by asking what UTC offset that zone was at on that
 * date. Going through `civilDate` rather than truncating UTC is the
 * whole point: a doctor whose evening clinic falls after UTC midnight
 * must not be shown tomorrow's count on the "Today" card.
 *
 * The week is the trailing seven days ending at today's end, which is
 * what "completed this week" means on a card sitting beside "today" —
 * a Monday-anchored week would read as zero every Monday morning.
 */
function clinicDayBounds(
  timeZone: string,
  now: Date,
): { todayStart: Date; todayEnd: Date; weekStart: Date; now: Date } {
  const todayStart = startOfCivilDay(now, timeZone);
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);

  return {
    todayStart,
    todayEnd,
    weekStart: new Date(todayEnd.getTime() - 7 * DAY_MS),
    now,
  };
}

/**
 * Midnight of `instant`'s civil day in `timeZone`, as a UTC instant.
 *
 * There is no direct "build a Date from civil fields in a zone" in the
 * platform, so this inverts the formatter: take the civil date, read it
 * *as if* it were UTC, then subtract the zone's offset at that moment.
 * One refinement pass follows, because the offset at UTC-midnight can
 * differ from the offset at the clinic's own midnight across a DST
 * boundary — after the correction both agree, and a second pass would
 * change nothing.
 */
function startOfCivilDay(instant: Date, timeZone: string): Date {
  const [year, month, day] = civilDate(instant, timeZone).split('-').map(Number);
  const asIfUtc = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);

  const firstGuess = new Date(asIfUtc - offsetAt(new Date(asIfUtc), timeZone));

  return new Date(asIfUtc - offsetAt(firstGuess, timeZone));
}

/**
 * `timeZone`'s offset from UTC at an instant, in milliseconds.
 *
 * Positive east of Greenwich, matching the sign convention
 * `startOfCivilDay` subtracts with. Rounded to the minute because the
 * civil reading carries no seconds, and the instant's own seconds would
 * otherwise leak into the offset.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const moment = civilMoment(instant, timeZone);
  const [hours, minutes] = moment.time.split(':').map(Number);
  const [year, month, day] = moment.date.split('-').map(Number);
  const asIfUtc = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0);

  return Math.round((asIfUtc - instant.getTime()) / 60_000) * 60_000;
}

/**
 * The window a calendar view covers, in the server's own reckoning.
 *
 * `day`, `week` and `month` are anchored on `date` (defaulting to now)
 * and ignore `from`/`to`; `list` uses `from`/`to` as given. A week runs
 * Monday to Monday, matching the `Weekday` enum's own ordering.
 */
function calendarWindow(query: AppointmentListQuery): {
  from: Date | undefined;
  to: Date | undefined;
} {
  if (query.view === 'list') return { from: query.from, to: query.to };

  const anchor = query.date ?? new Date();
  const startOfDay = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()),
  );

  if (query.view === 'day') {
    return { from: startOfDay, to: new Date(startOfDay.getTime() + DAY_MS) };
  }

  if (query.view === 'week') {
    // `getUTCDay()` is Sunday-based; the clinic's week starts Monday.
    const offset = (startOfDay.getUTCDay() + 6) % 7;
    const from = new Date(startOfDay.getTime() - offset * DAY_MS);

    return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
  }

  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));

  return { from, to };
}

/**
 * 404 for an appointment outside the caller's book.
 *
 * Byte-identical to a genuinely missing one, and carrying no reference:
 * a caller who could tell the two apart could walk `APT-3000`,
 * `APT-3001`, … and learn the clinic's booking volume without reading a
 * single appointment. The same reasoning ADR-022 records for charts.
 */
function notFound(message = 'Appointment not found'): AppException {
  return AppException.notFound(message);
}

function notADoctor(): AppException {
  return AppException.notFound('No doctor profile for this account');
}

/**
 * The compare-and-set lost.
 *
 * Someone else moved the row between this request reading it and
 * writing it. 409 rather than a retry: the caller acted on a view that
 * is now wrong, and re-applying their intent to a state they never saw
 * is how an appointment gets cancelled twice for two different reasons.
 */
function staleWrite(): AppException {
  return AppException.conflict(
    'The appointment changed while this request was in flight; reload and try again',
    'stale_write',
  );
}
