/**
 * The patient-facing information layer, read for the personal assistant
 * (ADR-050, contract §4 and §6).
 *
 * ## Read-only, and named so the containment spec covers it
 *
 * The file name ends in `ai-context.repository.ts` on purpose:
 * `ai-containment.spec.ts` allows clinical tables to be reached only from
 * files with that suffix, and asserts they carry no write method. This one
 * has none.
 *
 * ## What is selected is the whole policy
 *
 * Every `select` below is explicit and never spread. The forbidden lab
 * fields — `clinicalIndication`, `interpretation`, results, flags,
 * `hasCriticalResult`, the reviewer, the ordering doctor's notes — are not
 * selected, so they cannot reach the prompt by any later edit to the
 * renderer. Appointment `reason` and `notes` are not selected either:
 * they may be text the patient typed, and patient-supplied text never
 * enters the data block (prompt-injection hardening).
 *
 * The rows are keyed on the patient's public handle that
 * `PatientSelfScopeService` resolved from the session — never on a client
 * parameter — so another patient's rows are unreachable from here.
 *
 * Implemented directly against Prisma (rather than through the `/me/lab-orders`
 * service another slice is building) because ADR-019 forbids importing
 * another module's internals; the projection is kept identical to §4.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

/** How many of each kind the block carries. A bound, not a page. */
export const PERSONAL_CONTEXT_LIMIT = 20;

export interface AppointmentFact {
  readonly id: string;
  readonly startsAt: Date;
  readonly durationMin: number;
  readonly status: string;
  readonly visitType: string | null;
  readonly department: string | null;
  readonly doctorName: string;
  readonly specialty: string;
  readonly hospitalId: string | null;
}

export interface LabOrderFact {
  readonly id: string;
  readonly testName: string;
  readonly category: string;
  readonly specimenType: string;
  readonly status: string;
  readonly requestedAt: Date;
  readonly collectedAt: Date | null;
  readonly completedAt: Date | null;
  readonly hospitalId: string | null;
}

export interface InsuranceFact {
  readonly providerName: string;
  readonly plan: string | null;
  readonly validUntil: Date | null;
  readonly isActive: boolean;
  readonly updatedAt: Date;
}

@Injectable()
export class PatientAiContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async appointments(patientPublicId: string): Promise<readonly AppointmentFact[]> {
    const rows = await this.prisma.db.appointment.findMany({
      where: { patient: { publicId: patientPublicId }, deletedAt: null },
      select: {
        publicId: true,
        startsAt: true,
        durationMin: true,
        status: true,
        hospitalId: true,
        visitType: { select: { name: true } },
        department: { select: { name: true } },
        doctor: { select: { fullName: true, specialty: true } },
      },
      orderBy: { startsAt: 'desc' },
      take: PERSONAL_CONTEXT_LIMIT,
    });

    return rows.map((row) => ({
      id: row.publicId,
      startsAt: row.startsAt,
      durationMin: row.durationMin,
      status: row.status,
      visitType: row.visitType.name,
      department: row.department?.name ?? null,
      doctorName: row.doctor.fullName,
      specialty: row.doctor.specialty,
      hospitalId: row.hospitalId,
    }));
  }

  async labOrders(patientPublicId: string): Promise<readonly LabOrderFact[]> {
    const rows = await this.prisma.db.labOrder.findMany({
      // #17: a row with no hospital is not part of the patient-facing layer.
      where: { patient: { publicId: patientPublicId }, hospitalId: { not: null }, deletedAt: null },
      select: {
        publicId: true,
        status: true,
        requestedAt: true,
        collectedAt: true,
        completedAt: true,
        hospitalId: true,
        test: { select: { name: true, category: true, specimenType: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: PERSONAL_CONTEXT_LIMIT,
    });

    return rows.map((row) => ({
      id: row.publicId,
      testName: row.test.name,
      category: row.test.category,
      specimenType: row.test.specimenType,
      status: row.status,
      requestedAt: row.requestedAt,
      collectedAt: row.collectedAt,
      completedAt: row.completedAt,
      hospitalId: row.hospitalId,
    }));
  }

  /** The active policy if there is one, else the most recent; presence only — no policy number. */
  async insurance(patientPublicId: string): Promise<InsuranceFact | null> {
    const row = await this.prisma.db.patientInsurance.findFirst({
      where: { patient: { publicId: patientPublicId }, deletedAt: null },
      select: {
        plan: true,
        validUntil: true,
        isActive: true,
        updatedAt: true,
        provider: { select: { name: true } },
      },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });

    if (row === null) return null;

    return {
      providerName: row.provider.name,
      plan: row.plan,
      validUntil: row.validUntil,
      isActive: row.isActive,
      updatedAt: row.updatedAt,
    };
  }

  /** Hospital display names by id — organisational data, no patient in it. */
  async hospitalNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.db.hospital.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });

    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
