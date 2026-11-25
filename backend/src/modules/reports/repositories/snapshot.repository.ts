/**
 * The analytics aggregates (RM M21.1 — API §12.1).
 *
 * ## Doctor scope is a predicate on every query, not a filter afterwards
 *
 * API §12's own header is "Doctor scope = own data only". Every method
 * here takes the `doctors.id` behind the caller's account and puts it in
 * the `where`, so a colleague's practice is never loaded. A snapshot
 * assembled from clinic-wide rows and trimmed later is one refactor away
 * from showing a doctor someone else's numbers.
 *
 * ## Counting is done in the database
 *
 * Every figure is a `groupBy` or a `count`. Loading rows to count them
 * in TypeScript would pull a year of appointments into memory to produce
 * one integer, and the p95 the reports page needs would be the cost of
 * the transfer rather than the query.
 *
 * ## Demographic filters reach through the patient
 *
 * `gender` and `ageBand` are `ReportFilters` fields, and they filter the
 * *patients* a row is about — so they are expressed as a nested `patient`
 * predicate rather than applied to the aggregate. An age band is a date
 * window on `date_of_birth`, computed from the report's own clock so a
 * report run twice on either side of a birthday does not disagree with
 * itself for a reason nobody can see.
 */

import { Injectable } from '@nestjs/common';

import type { ClinicalEmployment } from '../../../shared/authz';

import type { Gender, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

export interface Window {
  readonly from: Date;
  readonly to: Date;
}

export interface Demographics {
  readonly gender: 'all' | 'female' | 'male';
  readonly ageBand: 'all' | '0-17' | '18-39' | '40-64' | '65+';
}

export interface LabelledCount {
  readonly label: string;
  readonly value: number;
}

/** Inclusive-of-band birth-date window, or null for "all". */
function birthWindow(band: Demographics['ageBand'], now: Date): { gte?: Date; lte?: Date } | null {
  if (band === 'all') return null;

  const atAge = (years: number): Date =>
    new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));

  switch (band) {
    // Someone aged 0–17 was born after their 18th birthday would have
    // been; the bound is exclusive at the older end for that reason.
    case '0-17':
      return { gte: atAge(18) };
    case '18-39':
      return { gte: atAge(40), lte: atAge(18) };
    case '40-64':
      return { gte: atAge(65), lte: atAge(40) };
    case '65+':
      return { lte: atAge(65) };
  }
}

function patientWhere(demographics: Demographics, now: Date): Prisma.PatientWhereInput | undefined {
  const birth = birthWindow(demographics.ageBand, now);
  const gender =
    demographics.gender === 'all' ? undefined : (demographics.gender.toUpperCase() as Gender);

  if (birth === null && gender === undefined) return undefined;

  return {
    ...(gender === undefined ? {} : { gender }),
    ...(birth === null ? {} : { dateOfBirth: birth }),
  };
}

/** Monday-first, matching the weekday axis the charts render. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** The heatmap's four blocks of the working day. */
export const TIME_BLOCKS = ['Early', 'Morning', 'Afternoon', 'Evening'] as const;

@Injectable()
export class SnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Counts, for the KPI band and its deltas ─────────────────── */

  appointmentCount(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<number> {
    return this.prisma.db.appointment.count({
      where: this.appointmentWhere(doctor, window, demographics, now),
    });
  }

  /**
   * Distinct patients this doctor saw in the window.
   *
   * Distinct, not appointment count: a patient with three visits is one
   * patient, and a KPI headed "Patients" that counted visits would
   * double the practice's size in a busy month.
   */
  async patientCount(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<number> {
    const grouped = await this.prisma.db.appointment.groupBy({
      by: ['patientId'],
      where: this.appointmentWhere(doctor, window, demographics, now),
    });

    return grouped.length;
  }

  labOrderCount(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<number> {
    const patient = patientWhere(demographics, now);

    return this.prisma.db.labOrder.count({
      where: {
        orderedBy: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        deletedAt: null,
        requestedAt: { gte: window.from, lt: window.to },
        ...(patient === undefined ? {} : { patient }),
      },
    });
  }

  prescriptionCount(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<number> {
    const patient = patientWhere(demographics, now);

    return this.prisma.db.prescription.count({
      where: {
        prescribingDoctorId: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        deletedAt: null,
        createdAt: { gte: window.from, lt: window.to },
        ...(patient === undefined ? {} : { patient }),
      },
    });
  }

  /* ── Series ──────────────────────────────────────────────────── */

  /** Appointments per weekday, Monday first. */
  async appointmentsByWeekday(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<readonly number[]> {
    const rows = await this.prisma.db.appointment.findMany({
      where: this.appointmentWhere(doctor, window, demographics, now),
      select: { startsAt: true },
    });

    const counts = new Array<number>(7).fill(0);
    for (const row of rows) {
      const day = (row.startsAt.getUTCDay() + 6) % 7;
      counts[day] = (counts[day] ?? 0) + 1;
    }

    return counts;
  }

  /**
   * Appointments per weekday × time block — the activity heatmap.
   *
   * One pass over the same rows the weekday chart reads, because asking
   * the database twice for one window is a second scan for a second
   * shape of the same answer.
   */
  async activityHeatmap(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<{ cells: number[][]; max: number }> {
    const rows = await this.prisma.db.appointment.findMany({
      where: this.appointmentWhere(doctor, window, demographics, now),
      select: { startsAt: true },
    });

    const cells = WEEKDAYS.map(() => new Array<number>(TIME_BLOCKS.length).fill(0));
    let max = 0;

    for (const row of rows) {
      const day = (row.startsAt.getUTCDay() + 6) % 7;
      const hour = row.startsAt.getUTCHours();
      const block = hour < 9 ? 0 : hour < 12 ? 1 : hour < 17 ? 2 : 3;
      const next = (cells[day]![block] ?? 0) + 1;

      cells[day]![block] = next;
      if (next > max) max = next;
    }

    return { cells, max };
  }

  /** A daily series across the window — the trend line. */
  async appointmentTrend(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<readonly LabelledCount[]> {
    const rows = await this.prisma.db.appointment.findMany({
      where: this.appointmentWhere(doctor, window, demographics, now),
      select: { startsAt: true },
      orderBy: { startsAt: 'asc' },
    });

    return bucketByDay(
      rows.map((row) => row.startsAt),
      window,
    );
  }

  async patientTrend(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<readonly LabelledCount[]> {
    const rows = await this.prisma.db.appointment.findMany({
      where: this.appointmentWhere(doctor, window, demographics, now),
      select: { startsAt: true, patientId: true },
      orderBy: { startsAt: 'asc' },
    });

    // First visit per patient in the window, so the trend counts people
    // arriving rather than appointments happening.
    const seen = new Set<string>();
    const firsts: Date[] = [];

    for (const row of rows) {
      if (seen.has(row.patientId)) continue;
      seen.add(row.patientId);
      firsts.push(row.startsAt);
    }

    return bucketByDay(firsts, window);
  }

  /** Patients per department, from the appointments that name one. */
  async patientsByDepartment(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<readonly LabelledCount[]> {
    const grouped = await this.prisma.db.appointment.groupBy({
      by: ['departmentId'],
      where: {
        ...this.appointmentWhere(doctor, window, demographics, now),
        departmentId: { not: null },
      },
      _count: { _all: true },
    });

    if (grouped.length === 0) return [];

    const ids = grouped.map((row) => row.departmentId).filter((id): id is string => id !== null);
    const names = await this.prisma.db.department.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((row) => [row.id, row.name]));

    return grouped
      .map((row) => ({
        label:
          row.departmentId === null ? 'Unassigned' : (nameById.get(row.departmentId) ?? 'Unknown'),
        value: row._count._all,
      }))
      .sort((a, b) => b.value - a.value);
  }

  /** Lab orders by status — the donut. */
  async labStatusSplit(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<readonly LabelledCount[]> {
    const patient = patientWhere(demographics, now);

    const grouped = await this.prisma.db.labOrder.groupBy({
      by: ['status'],
      where: {
        orderedBy: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        deletedAt: null,
        requestedAt: { gte: window.from, lt: window.to },
        ...(patient === undefined ? {} : { patient }),
      },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      label: String(row.status).toLowerCase(),
      value: row._count._all,
    }));
  }

  /** Critical, unreviewed results — the insight and the laboratory KPI. */
  criticalPending(doctor: ClinicalEmployment): Promise<number> {
    return this.prisma.db.labOrder.count({
      where: {
        orderedBy: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        deletedAt: null,
        hasCriticalResult: true,
        reviewedAt: null,
      },
    });
  }

  /** The patients' age distribution, bucketed into the four bands. */
  async ageDistribution(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Promise<readonly LabelledCount[]> {
    const grouped = await this.prisma.db.appointment.groupBy({
      by: ['patientId'],
      where: this.appointmentWhere(doctor, window, demographics, now),
    });

    if (grouped.length === 0) {
      return ['0-17', '18-39', '40-64', '65+'].map((label) => ({ label, value: 0 }));
    }

    const patients = await this.prisma.db.patient.findMany({
      where: { id: { in: grouped.map((row) => row.patientId) } },
      select: { dateOfBirth: true },
    });

    const buckets = { '0-17': 0, '18-39': 0, '40-64': 0, '65+': 0 };

    for (const patient of patients) {
      const age = Math.floor(
        (now.getTime() - patient.dateOfBirth.getTime()) / (365.25 * 86_400_000),
      );

      if (age < 18) buckets['0-17'] += 1;
      else if (age < 40) buckets['18-39'] += 1;
      else if (age < 65) buckets['40-64'] += 1;
      else buckets['65+'] += 1;
    }

    return Object.entries(buckets).map(([label, value]) => ({ label, value }));
  }

  /** Medical records by visit type — a varchar vocabulary, not the FK. */
  async recordsByType(
    doctor: ClinicalEmployment,
    window: Window,
  ): Promise<readonly LabelledCount[]> {
    const grouped = await this.prisma.db.medicalRecord.groupBy({
      by: ['visitType'],
      where: {
        doctorId: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        deletedAt: null,
        createdAt: { gte: window.from, lt: window.to },
      },
      _count: { _all: true },
    });

    return grouped
      .map((row) => ({ label: row.visitType, value: row._count._all }))
      .sort((a, b) => b.value - a.value);
  }

  /**
   * Prescriptions by medication — the pharmacy bar.
   *
   * `medication_id` is on `prescriptions` itself: this schema has no
   * line-item table, one prescription is one medication, so the group is
   * over the prescription rather than over items of it.
   */
  async prescriptionsByMedication(
    doctor: ClinicalEmployment,
    window: Window,
    limit: number,
  ): Promise<readonly LabelledCount[]> {
    const grouped = await this.prisma.db.prescription.groupBy({
      by: ['medicationId'],
      where: {
        prescribingDoctorId: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        deletedAt: null,
        createdAt: { gte: window.from, lt: window.to },
      },
      _count: { _all: true },
      orderBy: { _count: { medicationId: 'desc' } },
      take: limit,
    });

    if (grouped.length === 0) return [];

    const names = await this.prisma.db.medication.findMany({
      where: { id: { in: grouped.map((row) => row.medicationId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((row) => [row.id, row.name]));

    return grouped.map((row) => ({
      label: nameById.get(row.medicationId) ?? 'Unknown',
      value: row._count._all,
    }));
  }

  /** Messages this user sent, per weekday. */
  async messagesByWeekday(userId: string, window: Window): Promise<readonly number[]> {
    const rows = await this.prisma.db.message.findMany({
      where: { authorId: userId, sentAt: { gte: window.from, lt: window.to } },
      select: { sentAt: true },
    });

    const counts = new Array<number>(7).fill(0);
    for (const row of rows) {
      const day = (row.sentAt.getUTCDay() + 6) % 7;
      counts[day] = (counts[day] ?? 0) + 1;
    }

    return counts;
  }

  /** AI threads by context mode — "usage by feature". */
  async aiUsageByMode(userId: string, window: Window): Promise<readonly LabelledCount[]> {
    const grouped = await this.prisma.db.aiConversation.groupBy({
      by: ['contextMode'],
      where: { ownerId: userId, deletedAt: null, createdAt: { gte: window.from, lt: window.to } },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      label: String(row.contextMode).toLowerCase(),
      value: row._count._all,
    }));
  }

  private appointmentWhere(
    doctor: ClinicalEmployment,
    window: Window,
    demographics: Demographics,
    now: Date,
  ): Prisma.AppointmentWhereInput {
    const patient = patientWhere(demographics, now);

    return {
      // The doctor's own book at the active hospital (S4); rows with no
      // hospital (#17) or another hospital's are not this practice's.
      doctorId: doctor.doctorId,
      hospitalId: doctor.hospitalId,
      deletedAt: null,
      startsAt: { gte: window.from, lt: window.to },
      ...(patient === undefined ? {} : { patient }),
    };
  }
}

/**
 * Buckets timestamps into day-labelled points spanning the whole window.
 *
 * Every day in range is present, including the empty ones: a trend line
 * that skipped quiet days would draw a straight segment across them and
 * imply activity that did not happen. Windows longer than 62 days are
 * bucketed by month instead — a year of daily points is 365 labels no
 * axis can render.
 */
function bucketByDay(times: readonly Date[], window: Window): readonly LabelledCount[] {
  const days = Math.ceil((window.to.getTime() - window.from.getTime()) / 86_400_000);
  const byMonth = days > 62;
  const counts = new Map<string, number>();

  const key = (at: Date): string =>
    byMonth ? at.toISOString().slice(0, 7) : at.toISOString().slice(0, 10);

  for (
    let cursor = new Date(window.from);
    cursor < window.to;
    cursor = byMonth
      ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
      : new Date(cursor.getTime() + 86_400_000)
  ) {
    counts.set(key(cursor), 0);
  }

  for (const at of times) {
    const bucket = key(at);
    if (counts.has(bucket)) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}
