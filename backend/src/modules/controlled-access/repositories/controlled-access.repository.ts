/**
 * Persistence for Exceptional Access / Emergency Override grants and
 * cross-hospital information requests (multi-hospital §2.11, §2.12), and the
 * narrowly scoped reads they authorize.
 *
 * Every read here is confined to one patient at one hospital, and to rows
 * stamped with that hospital: a legacy row with `hospital_id IS NULL` is
 * never disclosed through a grant (§2.12, isolated until backfilled).
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import type { DataCategory } from '../dto/controlled-access.schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GrantRow {
  readonly id: string;
  readonly kind: string;
  readonly requesterUserId: string;
  readonly hospitalId: string;
  readonly patientId: string;
  readonly categories: string[];
  readonly status: string;
  readonly requiresApproval: boolean;
  readonly approverUserId: string | null;
  readonly durationMinutes: number;
  readonly startsAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly reviewedAt: Date | null;
  readonly reviewOutcome: string | null;
}

export interface RequestRow {
  readonly id: string;
  readonly requesterUserId: string;
  readonly requesterHospitalId: string | null;
  readonly targetHospitalId: string;
  readonly patientId: string;
  readonly requestedItems: string[];
  readonly approvedItems: string[];
  readonly status: string;
  readonly shareExpiresAt: Date | null;
  readonly revokedAt: Date | null;
}

const GRANT_SELECT = {
  id: true,
  kind: true,
  requesterUserId: true,
  hospitalId: true,
  patientId: true,
  categories: true,
  status: true,
  requiresApproval: true,
  approverUserId: true,
  durationMinutes: true,
  startsAt: true,
  expiresAt: true,
  revokedAt: true,
  reviewedAt: true,
  reviewOutcome: true,
} as const;

const REQUEST_SELECT = {
  id: true,
  requesterUserId: true,
  requesterHospitalId: true,
  targetHospitalId: true,
  patientId: true,
  requestedItems: true,
  approvedItems: true,
  status: true,
  shareExpiresAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class ControlledAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The patient's record at `hospitalId` (the scope a grant can name). */
  async recordAt(
    patientHandle: string,
    hospitalId: string,
  ): Promise<{ patientId: string; recordId: string; hospitalRequiresApproval: boolean } | null> {
    const row = await this.prisma.db.hospitalMedicalRecord.findFirst({
      where: {
        hospitalId,
        hospital: { is: { status: 'ACTIVE', deletedAt: null } },
        patient: {
          is: {
            OR: [{ publicId: patientHandle }, ...(UUID.test(patientHandle) ? [{ id: patientHandle }] : [])],
          },
        },
      },
      select: {
        id: true,
        patientId: true,
        hospital: { select: { exceptionalAccessRequiresApproval: true } },
      },
    });
    return row === null
      ? null
      : {
          patientId: row.patientId,
          recordId: row.id,
          hospitalRequiresApproval: row.hospital.exceptionalAccessRequiresApproval,
        };
  }

  async createGrant(data: {
    kind: string;
    requesterUserId: string;
    hospitalId: string;
    patientId: string;
    recordId: string;
    categories: string[];
    reason: string;
    requiresApproval: boolean;
    durationMinutes: number;
    reauthenticatedAt: Date;
    active: boolean;
  }): Promise<GrantRow> {
    const now = new Date();
    return this.prisma.db.exceptionalAccessGrant.create({
      data: {
        kind: data.kind,
        requesterUserId: data.requesterUserId,
        hospitalId: data.hospitalId,
        patientId: data.patientId,
        hospitalMedicalRecordId: data.recordId,
        categories: data.categories,
        reason: data.reason,
        requiresApproval: data.requiresApproval,
        durationMinutes: data.durationMinutes,
        reauthenticatedAt: data.reauthenticatedAt,
        status: data.active ? 'ACTIVE' : 'PENDING',
        ...(data.active
          ? { startsAt: now, expiresAt: new Date(now.getTime() + data.durationMinutes * 60_000) }
          : {}),
      },
      select: GRANT_SELECT,
    });
  }

  async grant(id: string): Promise<GrantRow | null> {
    if (!UUID.test(id)) return null;
    return this.prisma.db.exceptionalAccessGrant.findUnique({ where: { id }, select: GRANT_SELECT });
  }

  /** PENDING → ACTIVE|REJECTED, conditionally, so two deciders cannot both win. */
  async decideGrant(
    grant: GrantRow,
    approverUserId: string,
    approve: boolean,
    note: string | undefined,
  ): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.db.exceptionalAccessGrant.updateMany({
      where: { id: grant.id, status: 'PENDING' },
      data: {
        status: approve ? 'ACTIVE' : 'REJECTED',
        approverUserId,
        decidedAt: now,
        decisionNote: note ?? null,
        ...(approve
          ? { startsAt: now, expiresAt: new Date(now.getTime() + grant.durationMinutes * 60_000) }
          : {}),
      },
    });
    return result.count === 1;
  }

  async revokeGrant(id: string, actorId: string): Promise<boolean> {
    const result = await this.prisma.db.exceptionalAccessGrant.updateMany({
      where: { id, status: { in: ['PENDING', 'ACTIVE'] }, revokedAt: null },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: actorId },
    });
    return result.count === 1;
  }

  async reviewGrant(id: string, reviewerId: string, outcome: string): Promise<boolean> {
    const result = await this.prisma.db.exceptionalAccessGrant.updateMany({
      where: { id, kind: 'EMERGENCY', reviewedAt: null },
      data: { reviewedBy: reviewerId, reviewedAt: new Date(), reviewOutcome: outcome },
    });
    return result.count === 1;
  }

  async createRequest(data: {
    requesterUserId: string;
    requesterHospitalId: string | null;
    targetHospitalId: string;
    patientId: string;
    recordId: string;
    items: string[];
    reason: string;
  }): Promise<RequestRow> {
    return this.prisma.db.informationRequest.create({
      data: {
        requesterUserId: data.requesterUserId,
        requesterHospitalId: data.requesterHospitalId,
        targetHospitalId: data.targetHospitalId,
        patientId: data.patientId,
        hospitalMedicalRecordId: data.recordId,
        requestedItems: data.items,
        reason: data.reason,
      },
      select: REQUEST_SELECT,
    });
  }

  async request(id: string): Promise<RequestRow | null> {
    if (!UUID.test(id)) return null;
    return this.prisma.db.informationRequest.findUnique({ where: { id }, select: REQUEST_SELECT });
  }

  async decideRequest(
    id: string,
    deciderId: string,
    approved: { items: string[]; expiresAt: Date } | null,
    note: string | undefined,
  ): Promise<boolean> {
    const result = await this.prisma.db.informationRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: approved === null ? 'REJECTED' : 'APPROVED',
        decidedBy: deciderId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
        ...(approved === null ? {} : { approvedItems: approved.items, shareExpiresAt: approved.expiresAt }),
      },
    });
    return result.count === 1;
  }

  async revokeRequest(id: string): Promise<boolean> {
    const result = await this.prisma.db.informationRequest.updateMany({
      where: { id, status: { in: ['PENDING', 'APPROVED'] }, revokedAt: null },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return result.count === 1;
  }

  /** Hospital Admin user ids of a hospital (the people an override notifies). */
  async hospitalAdminIds(hospitalId: string): Promise<string[]> {
    const rows = await this.prisma.db.hospitalRoleAssignment.findMany({
      where: { hospitalId, revokedAt: null, role: { is: { code: 'admin' } } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /**
   * One category of one patient's data at one hospital. Only rows stamped
   * with that hospital; never another hospital's, never unstamped legacy.
   */
  async read(category: DataCategory, patientId: string, hospitalId: string): Promise<unknown> {
    const where = { patientId, hospitalId, deletedAt: null };
    switch (category) {
      case 'identity':
        return this.prisma.db.patient.findUnique({
          where: { id: patientId },
          select: { publicId: true, fullName: true, dateOfBirth: true, gender: true, bloodType: true },
        });
      case 'records':
        return this.prisma.db.medicalRecord.findMany({
          where,
          select: { publicId: true, visitDate: true, visitType: true, status: true, chiefComplaint: true },
          orderBy: { visitDate: 'desc' },
          take: 100,
        });
      case 'labs':
        return this.prisma.db.labOrder.findMany({
          where,
          select: { publicId: true, status: true, requestedAt: true, completedAt: true, hasCriticalResult: true },
          orderBy: { requestedAt: 'desc' },
          take: 100,
        });
      case 'prescriptions':
        return this.prisma.db.prescription.findMany({
          where,
          select: { publicId: true, status: true, strength: true, dosage: true, frequency: true, startDate: true, endDate: true },
          orderBy: { startDate: 'desc' },
          take: 100,
        });
      case 'allergies':
        return this.prisma.db.patientAllergy.findMany({
          where,
          select: { allergen: true, reaction: true, recordedAt: true },
          take: 100,
        });
    }
  }
}
