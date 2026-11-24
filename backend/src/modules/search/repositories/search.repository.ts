/**
 * The queries behind global search (API §16.1, RM M26).
 *
 * ## Care scope is a `WHERE` clause, not a filter applied afterwards
 *
 * Every doctor query below joins `patient_doctor_assignments` and
 * restricts to live assignments. That is the difference between a search
 * that cannot return another doctor's patient and one that fetches them
 * and then hides them — the second leaks through a count, a timing, or
 * the first refactor that forgets the filter. ADR-022 puts care scoping
 * in the service layer; this is that scoping expressed where the planner
 * can use it.
 *
 * ## Why no new trigram index
 *
 * M26.1 says "trigram-backed", and the patient search **is**:
 * `patients_full_name_trgm_idx` and `patients_mrn_trgm_idx` already
 * exist (DB §8) and serve the name and MRN match. Appointments and
 * records are deliberately searched *within the caller's own scope*,
 * where the selective predicate is the assignment join rather than the
 * text — one doctor's encounters are a small set, and a GIN index over
 * `appointments.reason` would not be chosen by the planner for it. So
 * there is no migration here: the index that would make this faster is
 * one the query would not use.
 */

import { Injectable } from '@nestjs/common';

import type { ClinicalEmployment } from '../../../shared/authz';

import { PrismaService } from '../../../shared/database';

export interface PatientHit {
  readonly publicId: string;
  readonly fullName: string;
  readonly mrn: string;
}

export interface AppointmentHit {
  readonly publicId: string;
  readonly reason: string;
  readonly startsAt: Date;
  readonly patient: { readonly fullName: string; readonly mrn: string };
}

export interface RecordHit {
  readonly publicId: string;
  readonly visitType: string;
  readonly chiefComplaint: string;
  readonly visitDate: Date;
  readonly patient: { readonly fullName: string; readonly mrn: string };
}

export interface NamedHit {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}

@Injectable()
export class SearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Doctor scope (M26.1) ──────────────────────────────────── */

  /**
   * Live assignments only — a revoked one is not a care relationship — and,
   * since S3/S4, only those owned by the doctor's active employment at the
   * active hospital (a legacy assignment with no hospital grants nothing, #17).
   */
  private scopedToDoctor(doctor: ClinicalEmployment) {
    return {
      careAssignments: {
        some: {
          doctorId: doctor.doctorId,
          doctorEmploymentId: doctor.doctorEmploymentId,
          hospitalId: doctor.hospitalId,
          revokedAt: null,
        },
      },
    };
  }

  patients(doctor: ClinicalEmployment, term: string, limit: number): Promise<PatientHit[]> {
    return this.prisma.db.patient.findMany({
      where: {
        ...this.scopedToDoctor(doctor),
        OR: [
          { fullName: { contains: term, mode: 'insensitive' } },
          { mrn: { contains: term, mode: 'insensitive' } },
          { publicId: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { publicId: true, fullName: true, mrn: true },
      orderBy: { fullName: 'asc' },
      take: limit,
    });
  }

  /**
   * The caller's **own** appointments, matched on the encounter's text or
   * on the patient it belongs to.
   *
   * `doctorId` rather than the assignment join: an appointment already
   * names its doctor, and "my appointments" is narrower than "my
   * patients' appointments" — a colleague's appointment with a patient I
   * also treat is their encounter, not mine, and the roster page it
   * links to would not show it.
   */
  appointments(doctor: ClinicalEmployment, term: string, limit: number): Promise<AppointmentHit[]> {
    return this.prisma.db.appointment.findMany({
      where: {
        // The active hospital's book only (S4).
        doctorId: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        OR: [
          { publicId: { contains: term, mode: 'insensitive' } },
          { reason: { contains: term, mode: 'insensitive' } },
          { patient: { fullName: { contains: term, mode: 'insensitive' } } },
          { patient: { mrn: { contains: term, mode: 'insensitive' } } },
        ],
      },
      select: {
        publicId: true,
        reason: true,
        startsAt: true,
        patient: { select: { fullName: true, mrn: true } },
      },
      orderBy: { startsAt: 'desc' },
      take: limit,
    });
  }

  records(doctor: ClinicalEmployment, term: string, limit: number): Promise<RecordHit[]> {
    return this.prisma.db.medicalRecord.findMany({
      where: {
        // The active hospital's records only (S4).
        doctorId: doctor.doctorId,
        hospitalId: doctor.hospitalId,
        OR: [
          { publicId: { contains: term, mode: 'insensitive' } },
          { visitType: { contains: term, mode: 'insensitive' } },
          { chiefComplaint: { contains: term, mode: 'insensitive' } },
          { patient: { fullName: { contains: term, mode: 'insensitive' } } },
          { patient: { mrn: { contains: term, mode: 'insensitive' } } },
        ],
      },
      select: {
        publicId: true,
        visitType: true,
        chiefComplaint: true,
        visitDate: true,
        patient: { select: { fullName: true, mrn: true } },
      },
      orderBy: { visitDate: 'desc' },
      take: limit,
    });
  }

  /* ── Admin scope (M26.2) ───────────────────────────────────── */

  async staff(term: string, limit: number): Promise<NamedHit[]> {
    const rows = await this.prisma.db.staffMember.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { title: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, title: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    return rows.map((row) => ({ id: row.id, name: row.name, detail: row.title }));
  }

  async departments(term: string, limit: number): Promise<NamedHit[]> {
    const rows = await this.prisma.db.department.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    return rows.map((row) => ({ id: row.id, name: row.name, detail: 'Department' }));
  }

  async rooms(term: string, limit: number): Promise<NamedHit[]> {
    const rows = await this.prisma.db.room.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    return rows.map((row) => ({ id: row.id, name: row.name, detail: 'Room' }));
  }

  async resources(term: string, limit: number): Promise<NamedHit[]> {
    const rows = await this.prisma.db.resource.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { category: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    return rows.map((row) => ({ id: row.id, name: row.name, detail: row.category }));
  }

  async announcements(term: string, limit: number): Promise<NamedHit[]> {
    const rows = await this.prisma.db.announcement.findMany({
      where: { title: { contains: term, mode: 'insensitive' } },
      select: { id: true, title: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({ id: row.id, name: row.title, detail: 'Announcement' }));
  }

  async policies(term: string, limit: number): Promise<NamedHit[]> {
    const rows = await this.prisma.db.policy.findMany({
      where: {
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { category: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, title: true, category: true },
      orderBy: { title: 'asc' },
      take: limit,
    });

    return rows.map((row) => ({ id: row.id, name: row.title, detail: row.category }));
  }

  async templates(term: string, limit: number): Promise<NamedHit[]> {
    const rows = await this.prisma.db.documentTemplate.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    return rows.map((row) => ({ id: row.id, name: row.name, detail: 'Template' }));
  }
}
