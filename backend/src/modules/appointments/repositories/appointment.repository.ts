/**
 * The appointment book (RM M11 — API §5).
 *
 * ## The doctor scope is a WHERE clause, never a check after the fetch
 *
 * Every doctor-facing query carries `doctorId` in its `where`. A filter
 * cannot be forgotten by a later caller, and a row that is not the
 * caller's is never loaded into memory — the same property
 * `PatientAppointmentRepository` documents for the patient side, for the
 * same reason. The administrator's oversight queries are the deliberate
 * exception and live in their own methods, reachable only from a
 * controller that requires an oversight capability.
 *
 * ## Transitions are compare-and-set
 *
 * `transition()` updates `WHERE id = ? AND status = ?` and reports the
 * row count. Two doctors approving the same request concurrently
 * produce one 200 and one 409 rather than two 200s and one lost event —
 * ADR-001's consequences name that test explicitly. Reading the row,
 * deciding, then writing would be the race; the predicate makes the
 * decision and the write the same statement.
 *
 * The status write and its `appointment_events` row are one
 * transaction. A history missing the transition that produced the
 * current state is worse than no history: it reads as though the row
 * changed itself.
 *
 * Soft deletes are handled globally by M4.2's client extension.
 *
 * ## Occupying a slot is serialised per doctor (BE-1)
 *
 * A compare-and-set predicate protects a row that already exists. It
 * cannot protect a slot, which is the *absence* of an overlapping row:
 * two bookings that each check "nothing overlaps" and then insert both
 * succeed under READ COMMITTED. So every write that gives a doctor a new
 * occupied interval — create, reschedule, reassign — runs inside
 * `withDoctorScheduleLock`, which takes the doctor's `doctors` row lock
 * as its first statement and holds it until commit. The slot check runs
 * inside the same transaction, after the lock, so it sees every booking
 * an earlier lock holder committed.
 *
 * The methods those writes use accept that transaction as an optional
 * last argument. Without one they behave exactly as before, which is
 * what every other caller still gets.
 */

import { Injectable } from '@nestjs/common';

import type { ClinicalEmployment, PatientClinicalScope } from '../../../shared/authz';

import type { Prisma } from '../../../generated/prisma/client';

import type {
  AppointmentAction,
  AppointmentPriority,
  AppointmentStatus,
  Gender,
  Weekday,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The transaction `withDoctorScheduleLock` hands to its work. */
export type ScheduleTx = Prisma.TransactionClient;

/**
 * How long a booking waits for another booking for the same doctor
 * before giving up — `lock_timeout`, set for the transaction only.
 *
 * A holder keeps the lock for a few indexed reads and two inserts, so a
 * wait this long means something is wrong; the caller gets a retryable
 * 503 rather than a request that hangs.
 */
const SCHEDULE_LOCK_TIMEOUT_MS = 5_000;

/**
 * Prisma's interactive-transaction limits for a locked booking. The
 * default `timeout` (5 s) equals the lock timeout, so a request that
 * waited the full lock timeout would be killed by Prisma first with an
 * opaque error. `timeout` therefore leaves room for the wait plus the
 * work; `maxWait` is the time to obtain a pooled connection.
 */
const SCHEDULE_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * The statuses a live booking can be in.
 *
 * Used by the overlap check (ADR-005 §4 rule 4) and by the time-off
 * impact list: a cancelled or completed appointment occupies no slot
 * and disturbs nothing.
 */
export const LIVE_STATUSES: readonly AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'PENDING',
  'RESCHEDULED',
  'AWAITING_PATIENT',
];

/** The patient columns API §5.1's snapshot needs, and no more. */
const PATIENT_SELECT = {
  id: true,
  publicId: true,
  fullName: true,
  mrn: true,
  phone: true,
  dateOfBirth: true,
  gender: true,
} as const;

const BOOK_SELECT = {
  id: true,
  publicId: true,
  startsAt: true,
  durationMin: true,
  status: true,
  priority: true,
  reason: true,
  notes: true,
  isNewPatient: true,
  isFollowUp: true,
  createdAt: true,
  updatedAt: true,
  cancelledReason: true,
  patient: { select: PATIENT_SELECT },
  doctor: { select: { id: true, fullName: true, specialty: true } },
  department: { select: { name: true } },
  visitType: { select: { name: true } },
} as const;

export interface BookRow {
  readonly id: string;
  readonly publicId: string;
  readonly startsAt: Date;
  readonly durationMin: number;
  readonly status: AppointmentStatus;
  readonly priority: AppointmentPriority;
  readonly reason: string;
  readonly notes: string | null;
  readonly isNewPatient: boolean;
  readonly isFollowUp: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly cancelledReason: string | null;
  readonly patient: {
    readonly id: string;
    readonly publicId: string;
    readonly fullName: string;
    readonly mrn: string;
    readonly phone: string;
    readonly dateOfBirth: Date;
    readonly gender: Gender;
  };
  readonly doctor: { readonly id: string; readonly fullName: string; readonly specialty: string };
  readonly department: { readonly name: string } | null;
  readonly visitType: { readonly name: string };
}

export interface EventRow {
  readonly id: string;
  readonly action: AppointmentAction;
  readonly fromStatus: AppointmentStatus | null;
  readonly toStatus: AppointmentStatus | null;
  readonly occurredAt: Date;
  readonly actorName: string | null;
  readonly reason: string | null;
  readonly detail: unknown;
}

export interface ProposalRow {
  readonly id: string;
  readonly status: string;
  readonly slot1: Date;
  readonly slot2: Date | null;
  readonly slot3: Date | null;
  readonly chosenSlot: number | null;
  readonly createdAt: Date;
}

export interface DetailRow extends BookRow {
  readonly events: readonly EventRow[];
  readonly proposals: readonly ProposalRow[];
}

export interface BookCriteria {
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly status?: readonly AppointmentStatus[] | undefined;
  readonly priority?: readonly AppointmentPriority[] | undefined;
  readonly visitType?: string | undefined;
  readonly department?: string | undefined;
  readonly q?: string | undefined;
  readonly sort: 'startsAt:asc' | 'startsAt:desc';
  readonly page: number;
  readonly pageSize: number;
  /** Calendar views return the whole window; only `list` paginates. */
  readonly paginate: boolean;
}

export interface SchedulingRow {
  readonly id: string;
  readonly defaultDurationMin: number;
  readonly bufferMin: number;
  readonly specialty: string;
  readonly availability: readonly {
    readonly weekday: Weekday;
    readonly startTime: Date;
    readonly endTime: Date;
    readonly isBreak: boolean;
  }[];
}

/** What a transition wrote, or `null` when the compare-and-set lost. */
export interface TransitionResult {
  readonly row: BookRow;
}

/**
 * A hospital-owned appointment cannot move to another doctor in place: its
 * `doctor_employment_id` is immutable once set (Phase 21), and the composite
 * foreign key ties it to the current doctor. Moving it needs a Database
 * transfer workflow that does not exist yet.
 */
export class HospitalOwnedAppointmentNotReassignable extends Error {
  constructor() {
    super('A hospital-owned appointment cannot be reassigned in place');
    this.name = 'HospitalOwnedAppointmentNotReassignable';
  }
}

@Injectable()
export class AppointmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's `doctors` row id, or null when they are not a doctor. */
  async doctorIdForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    // `findFirst`, not `findUnique`: the soft-delete extension filters only
    // the former, and a soft-deleted doctor is no doctor (#18).
    const doctor = await this.prisma.db.doctor.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });

    return doctor?.id ?? null;
  }

  /**
   * Runs `work` in one transaction holding the row lock of every doctor
   * in `doctorIds` (BE-1 — see the header).
   *
   * `FOR NO KEY UPDATE` rather than `FOR UPDATE`: it conflicts with
   * itself, so two bookings for one doctor queue, but not with the
   * `FOR KEY SHARE` a foreign-key check takes — inserting a lab order or
   * a record that references the doctor is never blocked by a booking.
   *
   * Several doctors (a reassign) are locked in one statement in id
   * order, so two transactions locking the same pair cannot deadlock.
   * The lock is released by commit or rollback; there is nothing to
   * unlock on an error path.
   */
  async withDoctorScheduleLock<T>(
    doctorIds: readonly string[],
    work: (tx: ScheduleTx) => Promise<T>,
  ): Promise<T> {
    const ids = [...new Set(doctorIds)].sort();

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(SCHEDULE_LOCK_TIMEOUT_MS)}, true)`;
      await tx.$queryRaw`
        SELECT id FROM doctors WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;

      return work(tx);
    }, SCHEDULE_TX_OPTIONS);
  }

  /**
   * The client a read runs on: the caller's transaction, or the base
   * client. Not `prisma.db` — a transaction client does not carry the
   * soft-delete extension, so the reads that take one spell out
   * `deletedAt: null` themselves and behave identically on either.
   */
  private client(tx?: ScheduleTx): ScheduleTx {
    return tx ?? this.prisma;
  }

  /**
   * Runs `work` in the caller's transaction when there is one, otherwise
   * in a fresh one — so a multi-row write is atomic either way.
   */
  private inTransaction<T>(
    outer: ScheduleTx | undefined,
    work: (tx: ScheduleTx) => Promise<T>,
  ): Promise<T> {
    return outer === undefined ? this.prisma.$transaction(work) : work(outer);
  }

  /** The doctor's scheduling defaults and weekly grid (ADR-005 §2). */
  async schedulingFor(doctorId: string, tx?: ScheduleTx): Promise<SchedulingRow | null> {
    if (!UUID.test(doctorId)) return null;

    return this.client(tx).doctor.findUnique({
      where: { id: doctorId },
      select: {
        id: true,
        defaultDurationMin: true,
        bufferMin: true,
        specialty: true,
        availability: {
          select: { weekday: true, startTime: true, endTime: true, isBreak: true },
          orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        },
      },
    });
  }

  /** ADR-005 §4 rule 3 — time off overlapping a candidate interval. */
  timeOffOverlapping(
    doctorId: string,
    from: Date,
    to: Date,
    tx?: ScheduleTx,
  ): Promise<readonly { startsAt: Date; endsAt: Date }[]> {
    return this.client(tx).doctorTimeOff.findMany({
      where: { doctorId, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true },
    });
  }

  /**
   * ADR-005 §4 rule 4 — live bookings near a candidate interval.
   *
   * The window is widened by the caller's buffer before the query rather
   * than filtered afterwards, so the index on `(doctor_id, starts_at)`
   * does the work. `excludeId` is how a reschedule avoids conflicting
   * with the appointment it is moving.
   *
   * `deletedAt: null` is spelled out because a transaction client does
   * not carry the soft-delete extension; outside one it is exactly what
   * the extension would have added.
   */
  bookedBetween(
    input: {
      readonly doctorId: string;
      readonly from: Date;
      readonly to: Date;
      readonly excludeId?: string | undefined;
    },
    tx?: ScheduleTx,
  ): Promise<readonly { publicId: string; startsAt: Date; durationMin: number }[]> {
    return this.client(tx).appointment.findMany({
      where: {
        deletedAt: null,
        doctorId: input.doctorId,
        status: { in: [...LIVE_STATUSES] },
        startsAt: { gte: input.from, lt: input.to },
        ...(input.excludeId === undefined ? {} : { NOT: { id: input.excludeId } }),
      },
      select: { publicId: true, startsAt: true, durationMin: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** API §5.1 — the doctor's book. */
  async list(
    doctor: ClinicalEmployment,
    criteria: BookCriteria,
  ): Promise<{ rows: readonly BookRow[]; totalItems: number }> {
    const where = this.whereFor(doctor, criteria);
    const orderBy = { startsAt: criteria.sort === 'startsAt:asc' ? 'asc' : 'desc' } as const;

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.appointment.findMany({
        where,
        select: BOOK_SELECT,
        orderBy,
        // A calendar view draws every cell it has; a page-2 link on a
        // week means nothing. The cap on the window is the date range,
        // which the service always sets for those views.
        ...(criteria.paginate
          ? { skip: (criteria.page - 1) * criteria.pageSize, take: criteria.pageSize }
          : {}),
      }),
      this.prisma.db.appointment.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * One appointment for a doctor, scoped in the WHERE.
   *
   * "Someone else's appointment" and "no such appointment" both produce
   * `null`, which the service turns into the identical 404.
   */
  findForDoctor(
    doctor: ClinicalEmployment,
    publicId: string,
    tx?: ScheduleTx,
  ): Promise<DetailRow | null> {
    return this.client(tx).appointment.findFirst({
      where: { publicId, ...ownBook(doctor), deletedAt: null },
      select: this.detailSelect(),
    });
  }

  /** One appointment with no doctor scope — the oversight detail. */
  findAny(publicId: string, tx?: ScheduleTx): Promise<DetailRow | null> {
    return this.client(tx).appointment.findFirst({
      where: { publicId, deletedAt: null },
      select: this.detailSelect(),
    });
  }

  /** `visit_types.name` → id. Active rows only; a retired type is not bookable. */
  async visitTypeIdByName(name: string): Promise<string | null> {
    const row = await this.prisma.db.visitType.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, active: true },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  /** `departments.name` → id. */
  async departmentIdByName(name: string): Promise<string | null> {
    const row = await this.prisma.db.department.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, status: 'ACTIVE' },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  /** The doctor's own department, used when the body names none. */
  async defaultDepartmentId(doctorId: string): Promise<string | null> {
    const row = await this.prisma.db.doctor.findUnique({
      where: { id: doctorId },
      select: { departmentId: true },
    });

    return row?.departmentId ?? null;
  }

  async patientByPublicId(
    publicId: string,
  ): Promise<{ id: string; publicId: string } | null> {
    return this.prisma.db.patient.findFirst({
      where: { publicId },
      select: { id: true, publicId: true },
    });
  }

  /** The next `APT-…` reference. */
  async nextReference(tx?: ScheduleTx): Promise<string> {
    const rows = await (tx ?? this.prisma).$queryRaw<
      Array<{ value: bigint }>
    >`SELECT nextval('appointment_reference_seq') AS value`;

    return `APT-${String(rows[0]?.value ?? 3000)}`;
  }

  /**
   * API §5.3 — the booking and its `created` event, in one transaction.
   *
   * An appointment whose history does not begin with its creation reads
   * as though it appeared on its own, so the two rows land together or
   * neither does.
   */
  async create(
    input: {
      readonly publicId: string;
      /** The chart's scope: patient, hospital, medical record, employment (S4). */
      readonly scope: PatientClinicalScope;
      readonly departmentId: string | null;
      readonly visitTypeId: string;
      readonly startsAt: Date;
      readonly durationMin: number;
      readonly status: AppointmentStatus;
      readonly priority: AppointmentPriority;
      readonly reason: string;
      readonly notes: string | null;
      readonly isNewPatient: boolean;
      readonly isFollowUp: boolean;
      readonly actorId: string;
      readonly actorName: string;
    },
    outer?: ScheduleTx,
  ): Promise<BookRow> {
    return this.inTransaction(outer, async (tx) => {
      const created = await tx.appointment.create({
        data: {
          publicId: input.publicId,
          patientId: input.scope.patientId,
          doctorId: input.scope.doctorId,
          hospitalId: input.scope.hospitalId,
          hospitalMedicalRecordId: input.scope.hospitalMedicalRecordId,
          doctorEmploymentId: input.scope.doctorEmploymentId,
          departmentId: input.departmentId,
          visitTypeId: input.visitTypeId,
          startsAt: input.startsAt,
          durationMin: input.durationMin,
          status: input.status,
          priority: input.priority,
          reason: input.reason,
          notes: input.notes,
          isNewPatient: input.isNewPatient,
          isFollowUp: input.isFollowUp,
          ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
        },
        select: BOOK_SELECT,
      });

      await tx.appointmentEvent.create({
        data: {
          appointmentId: created.id,
          action: 'CREATED',
          toStatus: input.status,
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
        },
      });

      return created;
    });
  }

  /**
   * Compare-and-set the status and write the history row.
   *
   * Returns `null` when the row was not in `from` — either someone else
   * moved it first, or the caller is acting on a stale view. The service
   * turns that into the 409 that says so.
   */
  async transition(
    input: {
      readonly appointmentId: string;
      readonly from: AppointmentStatus;
      readonly to: AppointmentStatus;
      readonly action: AppointmentAction;
      readonly actorId: string;
      readonly actorName: string;
      readonly reason: string | null;
      readonly detail?: Readonly<Record<string, unknown>> | undefined;
      /** Set on a cancellation — the column the P4 CHECK requires. */
      readonly cancelledReason?: string | undefined;
      /** Set on a reschedule, which moves the slot as it changes status. */
      readonly startsAt?: Date | undefined;
      readonly durationMin?: number | undefined;
      readonly doctorId?: string | undefined;
    },
    outer?: ScheduleTx,
  ): Promise<TransitionResult | null> {
    return this.inTransaction(outer, async (tx) => {
      const updated = await tx.appointment.updateMany({
        where: { id: input.appointmentId, status: input.from },
        data: {
          status: input.to,
          ...(input.cancelledReason === undefined
            ? {}
            : { cancelledReason: input.cancelledReason }),
          ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
          ...(input.durationMin === undefined ? {} : { durationMin: input.durationMin }),
          ...(input.doctorId === undefined ? {} : { doctorId: input.doctorId }),
          ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
        },
      });

      // Lost the race. Nothing was written, and nothing is written now:
      // an event row for a transition that did not happen is a lie in
      // the history.
      if (updated.count === 0) return null;

      await tx.appointmentEvent.create({
        data: {
          appointmentId: input.appointmentId,
          action: input.action,
          fromStatus: input.from,
          toStatus: input.to,
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
          reason: input.reason,
          ...(input.detail === undefined ? {} : { detail: toJson(input.detail) }),
        },
      });

      const row = await tx.appointment.findUniqueOrThrow({
        where: { id: input.appointmentId },
        select: BOOK_SELECT,
      });

      return { row };
    });
  }

  /**
   * An event with no status change — `nudged`, and nothing else today.
   *
   * Separate from `transition()` because it is genuinely a different
   * operation: the row does not move, so there is no predicate to
   * compare and set and no race to lose.
   */
  async recordEvent(input: {
    readonly appointmentId: string;
    readonly action: AppointmentAction;
    readonly actorId: string;
    readonly actorName: string;
    readonly reason: string | null;
    readonly detail?: Readonly<Record<string, unknown>> | undefined;
  }): Promise<void> {
    await this.prisma.db.appointmentEvent.create({
      data: {
        appointmentId: input.appointmentId,
        action: input.action,
        ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
        actorName: input.actorName,
        reason: input.reason,
        ...(input.detail === undefined ? {} : { detail: toJson(input.detail) }),
      },
    });
  }

  /** API §5.8 — the proposal row that accompanies `awaiting-patient`. */
  async createProposal(input: {
    readonly appointmentId: string;
    readonly proposedBy: string;
    readonly slots: readonly Date[];
  }): Promise<ProposalRow> {
    const [slot1, slot2, slot3] = input.slots;

    return this.prisma.db.appointmentRescheduleProposal.create({
      data: {
        appointmentId: input.appointmentId,
        ...(UUID.test(input.proposedBy) ? { proposedBy: input.proposedBy } : {}),
        // `slot1` is non-null in the schema and the Zod array has a
        // minimum of one, so this is total — the fallback exists to
        // satisfy `noUncheckedIndexedAccess`, not to cover a case.
        slot1: slot1 ?? new Date(),
        slot2: slot2 ?? null,
        slot3: slot3 ?? null,
      },
      select: {
        id: true,
        status: true,
        slot1: true,
        slot2: true,
        slot3: true,
        chosenSlot: true,
        createdAt: true,
      },
    });
  }

  /** Supersedes any outstanding proposal when the appointment resolves. */
  async expireProposals(appointmentId: string): Promise<void> {
    await this.prisma.db.appointmentRescheduleProposal.updateMany({
      where: { appointmentId, status: 'pending' },
      data: { status: 'expired' },
    });
  }

  /** When the row last changed status — the oversight age-in-state anchor. */
  async lastTransitionAt(
    appointmentIds: readonly string[],
  ): Promise<Readonly<Record<string, Date>>> {
    if (appointmentIds.length === 0) return {};

    const rows = await this.prisma.db.appointmentEvent.findMany({
      where: { appointmentId: { in: [...appointmentIds] }, toStatus: { not: null } },
      select: { appointmentId: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
    });

    const latest: Record<string, Date> = {};
    for (const row of rows) latest[row.appointmentId] ??= row.occurredAt;

    return latest;
  }

  /** Reschedule counts and last-nudge times, for the oversight flags. */
  async oversightSignals(
    appointmentIds: readonly string[],
  ): Promise<Readonly<Record<string, { reschedules: number; lastNudgedAt: Date | null }>>> {
    if (appointmentIds.length === 0) return {};

    const rows = await this.prisma.db.appointmentEvent.findMany({
      where: {
        appointmentId: { in: [...appointmentIds] },
        action: { in: ['RESCHEDULE', 'NUDGED'] },
      },
      select: { appointmentId: true, action: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
    });

    const signals: Record<string, { reschedules: number; lastNudgedAt: Date | null }> = {};

    for (const row of rows) {
      const bucket = (signals[row.appointmentId] ??= { reschedules: 0, lastNudgedAt: null });
      if (row.action === 'RESCHEDULE') bucket.reschedules += 1;
      else bucket.lastNudgedAt ??= row.occurredAt;
    }

    return signals;
  }

  /** `users.display_name`, for the `actor_name` snapshot (ADR-003 §4). */
  async displayNameForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    const row = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });

    return row?.displayName ?? null;
  }

  /**
   * API §5.11 — the four cards above the book.
   *
   * Four `count`s rather than one grouped query and arithmetic in the
   * service: each card asks a different question over a different window,
   * and a `groupBy` would have to be post-filtered per card anyway. The
   * counts run concurrently, so the cost is one round trip.
   *
   * "Today" and "this week" are the **clinic's** days, resolved from the
   * civil date rather than from UTC — a card that said "3 today" to a
   * doctor whose evening clinic falls after UTC midnight would be
   * describing tomorrow.
   */
  async summaryFor(
    doctor: ClinicalEmployment,
    bounds: {
      readonly todayStart: Date;
      readonly todayEnd: Date;
      readonly weekStart: Date;
      readonly now: Date;
    },
  ): Promise<{
    today: number;
    pending: number;
    upcoming: number;
    completedThisWeek: number;
  }> {
    const own = ownBook(doctor);
    const [today, pending, upcoming, completedThisWeek] = await Promise.all([
      this.prisma.db.appointment.count({
        where: {
          ...own,
          startsAt: { gte: bounds.todayStart, lt: bounds.todayEnd },
          status: { in: [...LIVE_STATUSES, 'COMPLETED'] },
        },
      }),
      this.prisma.db.appointment.count({ where: { ...own, status: 'PENDING' } }),
      this.prisma.db.appointment.count({
        where: {
          ...own,
          startsAt: { gte: bounds.now },
          status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] },
        },
      }),
      this.prisma.db.appointment.count({
        where: {
          ...own,
          status: 'COMPLETED',
          startsAt: { gte: bounds.weekStart, lt: bounds.todayEnd },
        },
      }),
    ]);

    return { today, pending, upcoming, completedThisWeek };
  }

  /**
   * The administrator's strip (API §5.11) — rates over the trailing week.
   *
   * The denominator is on the wire because a rate quoted from three
   * appointments is not a rate, and only a client that can see the
   * denominator can decline to draw it.
   */
  async adminSummary(
    bounds: { readonly weekStart: Date; readonly now: Date },
  ): Promise<{
    pendingOverDay: number;
    cancelled7d: number;
    noShow7d: number;
    window7dTotal: number;
  }> {
    const dayAgo = new Date(bounds.now.getTime() - 86_400_000);

    const [pendingOverDay, cancelled7d, noShow7d, window7dTotal] = await Promise.all([
      this.prisma.db.appointment.count({
        where: { status: 'PENDING', createdAt: { lt: dayAgo } },
      }),
      this.prisma.db.appointment.count({
        where: { status: 'CANCELLED', startsAt: { gte: bounds.weekStart, lt: bounds.now } },
      }),
      this.prisma.db.appointment.count({
        where: { status: 'NO_SHOW', startsAt: { gte: bounds.weekStart, lt: bounds.now } },
      }),
      this.prisma.db.appointment.count({
        where: { startsAt: { gte: bounds.weekStart, lt: bounds.now } },
      }),
    ]);

    return { pendingOverDay, cancelled7d, noShow7d, window7dTotal };
  }

  /**
   * API §5.10 — the cross-doctor oversight list.
   *
   * Deliberately its own method rather than a nullable `doctorId` on
   * `list()`. An unscoped read of the appointment book is a different
   * authorization decision, and a parameter that widens a scope when it
   * happens to be null is one forgotten argument away from serving every
   * doctor's book to a caller who asked for their own.
   */
  async oversightList(criteria: {
    readonly from?: Date | undefined;
    readonly to?: Date | undefined;
    readonly status?: readonly AppointmentStatus[] | undefined;
    readonly doctorId?: string | undefined;
    readonly department?: string | undefined;
    readonly q?: string | undefined;
    readonly sort: 'startsAt:asc' | 'startsAt:desc' | 'stateSince:asc';
    readonly page: number;
    readonly pageSize: number;
  }): Promise<{ rows: readonly BookRow[]; totalItems: number }> {
    const where = {
      ...(criteria.status === undefined || criteria.status.length === 0
        ? {}
        : { status: { in: [...criteria.status] } }),
      ...(criteria.doctorId === undefined ? {} : { doctorId: criteria.doctorId }),
      ...(criteria.from === undefined && criteria.to === undefined
        ? {}
        : {
            startsAt: {
              ...(criteria.from === undefined ? {} : { gte: criteria.from }),
              ...(criteria.to === undefined ? {} : { lt: criteria.to }),
            },
          }),
      ...(criteria.department === undefined
        ? {}
        : {
            department: {
              name: { equals: criteria.department, mode: 'insensitive' as const },
            },
          }),
      // Reference, doctor and department only — never the patient name
      // or MRN. A search box that resolved masked identifiers would hand
      // back exactly what the mask withholds.
      ...(criteria.q === undefined
        ? {}
        : {
            OR: [
              { publicId: { contains: criteria.q, mode: 'insensitive' as const } },
              {
                doctor: {
                  fullName: { contains: criteria.q, mode: 'insensitive' as const },
                },
              },
              {
                department: {
                  name: { contains: criteria.q, mode: 'insensitive' as const },
                },
              },
            ],
          }),
    };

    // `stateSince` is derived from the event trail, so it cannot be an
    // ORDER BY here; the service sorts that one after enriching. The
    // date orderings stay in the database, where the index is.
    const orderBy =
      criteria.sort === 'startsAt:desc'
        ? ({ startsAt: 'desc' } as const)
        : ({ startsAt: 'asc' } as const);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.appointment.findMany({
        where,
        select: BOOK_SELECT,
        orderBy,
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.appointment.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * The same four cards as `summaryFor`, across every doctor.
   *
   * The administrator's strip sits above the platform's book, not above
   * one doctor's, so the numbers beside its rates have to be unscoped —
   * reusing `summaryFor` with a sentinel doctor id would be the kind of
   * "null widens the scope" parameter this repository avoids elsewhere.
   */
  async platformCounts(bounds: { readonly now: Date }): Promise<{
    today: number;
    pending: number;
    upcoming: number;
    completedThisWeek: number;
  }> {
    const dayStart = new Date(
      Date.UTC(
        bounds.now.getUTCFullYear(),
        bounds.now.getUTCMonth(),
        bounds.now.getUTCDate(),
      ),
    );
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const weekStart = new Date(dayEnd.getTime() - 7 * 86_400_000);

    const [today, pending, upcoming, completedThisWeek] = await Promise.all([
      this.prisma.db.appointment.count({
        where: {
          startsAt: { gte: dayStart, lt: dayEnd },
          status: { in: [...LIVE_STATUSES, 'COMPLETED'] },
        },
      }),
      this.prisma.db.appointment.count({ where: { status: 'PENDING' } }),
      this.prisma.db.appointment.count({
        where: {
          startsAt: { gte: bounds.now },
          status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] },
        },
      }),
      this.prisma.db.appointment.count({
        where: { status: 'COMPLETED', startsAt: { gte: weekStart, lt: dayEnd } },
      }),
    ]);

    return { today, pending, upcoming, completedThisWeek };
  }

  /**
   * API §5.10 — move an appointment to another doctor.
   *
   * The status is untouched, so this is not a `transition()`: the
   * compare-and-set predicate is the **current doctor** rather than the
   * current status, which is the field this write is racing on. Two
   * administrators reassigning the same appointment concurrently produce
   * one 200 and one 409, for the same reason and by the same mechanism.
   */
  async reassignTo(
    input: {
      readonly appointmentId: string;
      readonly fromDoctorId: string;
      readonly toDoctorId: string;
      readonly actorId: string;
      readonly actorName: string;
      readonly reason: string;
    },
    outer?: ScheduleTx,
  ): Promise<BookRow | null> {
    return this.inTransaction(outer, async (tx) => {
      // A hospital-owned booking is tied to its doctor's employment, and
      // `prevent_tenant_scope_reassignment` forbids changing that key in
      // place (Phase 21: "not a transfer workflow"). Refused here, before
      // the database turns it into a 500.
      const owner = await tx.appointment.findUnique({
        where: { id: input.appointmentId },
        select: { doctorEmploymentId: true },
      });
      if (owner !== null && owner.doctorEmploymentId !== null) {
        throw new HospitalOwnedAppointmentNotReassignable();
      }

      const updated = await tx.appointment.updateMany({
        where: { id: input.appointmentId, doctorId: input.fromDoctorId },
        data: {
          doctorId: input.toDoctorId,
          ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
        },
      });

      if (updated.count === 0) return null;

      await tx.appointmentEvent.create({
        data: {
          appointmentId: input.appointmentId,
          action: 'REASSIGNED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
          reason: input.reason,
          detail: { fromDoctorId: input.fromDoctorId, toDoctorId: input.toDoctorId },
        },
      });

      return tx.appointment.findUniqueOrThrow({
        where: { id: input.appointmentId },
        select: BOOK_SELECT,
      });
    });
  }

  /** A doctor's id and specialty, for the reassign same-specialty rule. */
  async doctorSummary(
    doctorId: string,
  ): Promise<{ id: string; specialty: string; fullName: string } | null> {
    if (!UUID.test(doctorId)) return null;

    // `findFirst` with `deletedAt: null`: a soft-deleted doctor is not a
    // reassignment target (#18), and `findUnique` bypasses the extension.
    return this.prisma.db.doctor.findFirst({
      where: { id: doctorId, deletedAt: null },
      select: { id: true, specialty: true, fullName: true },
    });
  }

  /** One of the caller's own time-off blocks, for the M11.5 resolution. */
  async timeOffFor(
    doctorId: string,
    timeOffId: string,
  ): Promise<{ id: string; startsAt: Date; endsAt: Date } | null> {
    if (!UUID.test(timeOffId)) return null;

    return this.prisma.db.doctorTimeOff.findFirst({
      where: { id: timeOffId, doctorId },
      select: { id: true, startsAt: true, endsAt: true },
    });
  }

  /**
   * Live appointments a time-off block disturbs (ADR-005 §7).
   *
   * Deliberately the same predicate `AvailabilityRepository` uses for the
   * impact list M9.4 returns, because the two numbers must agree: the
   * doctor confirms a count taken from one and this acts on the other,
   * and `confirmedCount` is only a safety property if they are the same
   * query.
   */
  impactedByTimeOff(doctorId: string, from: Date, to: Date): Promise<readonly BookRow[]> {
    return this.prisma.db.appointment.findMany({
      where: { doctorId, startsAt: { gte: from, lt: to }, status: { in: [...LIVE_STATUSES] } },
      select: BOOK_SELECT,
      orderBy: { startsAt: 'asc' },
    });
  }

  private detailSelect() {
    return {
      ...BOOK_SELECT,
      events: {
        select: {
          id: true,
          action: true,
          fromStatus: true,
          toStatus: true,
          occurredAt: true,
          actorName: true,
          reason: true,
          detail: true,
        },
        orderBy: { occurredAt: 'desc' },
      },
      proposals: {
        select: {
          id: true,
          status: true,
          slot1: true,
          slot2: true,
          slot3: true,
          chosenSlot: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    } as const;
  }

  private whereFor(doctor: ClinicalEmployment, criteria: BookCriteria) {
    return {
      ...ownBook(doctor),
      ...(criteria.status === undefined || criteria.status.length === 0
        ? {}
        : { status: { in: [...criteria.status] } }),
      ...(criteria.priority === undefined || criteria.priority.length === 0
        ? {}
        : { priority: { in: [...criteria.priority] } }),
      ...(criteria.from === undefined && criteria.to === undefined
        ? {}
        : {
            startsAt: {
              ...(criteria.from === undefined ? {} : { gte: criteria.from }),
              ...(criteria.to === undefined ? {} : { lt: criteria.to }),
            },
          }),
      ...(criteria.visitType === undefined
        ? {}
        : { visitType: { name: { equals: criteria.visitType, mode: 'insensitive' as const } } }),
      ...(criteria.department === undefined
        ? {}
        : { department: { name: { equals: criteria.department, mode: 'insensitive' as const } } }),
      ...(criteria.q === undefined ? {} : { patient: patientMatch(criteria.q) }),
    };
  }
}

/**
 * An event `detail` as Prisma's JSON input type.
 *
 * The callers build plain objects of strings, numbers and arrays — the
 * `jsonb` column exists because the shape varies by action — and Prisma's
 * `InputJsonValue` is structurally that. The assertion is confined to
 * this one function rather than repeated at each call site, so there is
 * a single place to look when the column's contents are in question.
 */
function toJson(detail: Readonly<Record<string, unknown>>): Prisma.InputJsonValue {
  return detail as Prisma.InputJsonValue;
}

/**
 * `?q=` matches the patient's name, `PT-…` handle or MRN.
 *
 * API §5.1 says "`q` (patient)". Three fields rather than one because a
 * clinician searching the book types whichever identifier is in front of
 * them, and a search that only matched one of the three would look
 * broken for the other two.
 */
function patientMatch(q: string) {
  const mode = 'insensitive' as const;

  return {
    OR: [
      { fullName: { contains: q, mode } },
      { publicId: { contains: q, mode } },
      { mrn: { contains: q, mode } },
    ],
  };
}

/**
 * The doctor's own book at the active hospital (S4). A booking owned by
 * another hospital, or a legacy one with no hospital (#17), is not in it.
 */
function ownBook(doctor: ClinicalEmployment): { doctorId: string; hospitalId: string } {
  return { doctorId: doctor.doctorId, hospitalId: doctor.hospitalId };
}
