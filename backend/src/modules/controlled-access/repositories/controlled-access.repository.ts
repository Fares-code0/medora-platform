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

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';
import type { DataCategory } from '../dto/controlled-access.schema';

/** The transaction a lifecycle change and its audit row share (XH-09). */
export type Tx = Prisma.TransactionClient;

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

/** A list row: the view's fields plus who asked and when (XH-05). */
export interface GrantListRow extends GrantRow {
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly requester: { readonly id: string; readonly displayName: string };
}

export interface RequestListRow extends RequestRow {
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly requester: { readonly id: string; readonly displayName: string };
}

export interface Page<T> {
  readonly rows: readonly T[];
  readonly totalItems: number;
}

/** Which slice of the target hospital's grants an admin queue shows. */
export type GrantQueue = 'pending' | 'active' | 'review';
export type RequestQueue = 'pending' | 'approved';

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

const LIST_EXTRA = {
  createdAt: true,
  decidedAt: true,
  requester: { select: { id: true, displayName: true } },
} as const;

@Injectable()
export class ControlledAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs a lifecycle change and its audit row in one transaction (XH-09):
   * the throwing audit writer rolls the change back if the row cannot be
   * written, so no grant changes state unrecorded.
   */
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

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

  async createGrant(tx: Tx, data: {
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
    return tx.exceptionalAccessGrant.create({
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

  /**
   * PENDING → ACTIVE|REJECTED, conditionally, so two deciders cannot both
   * win. An approval carries its window and the categories the approver
   * kept (XH-01: a subset of those requested, already checked by the
   * service; the `categories` column then holds the approved set, which is
   * what every read checks).
   */
  async decideGrant(
    tx: Tx,
    grant: GrantRow,
    approverUserId: string,
    approval: { startsAt: Date; expiresAt: Date; categories: string[] } | null,
    note: string | undefined,
  ): Promise<boolean> {
    const result = await tx.exceptionalAccessGrant.updateMany({
      where: { id: grant.id, status: 'PENDING' },
      data: {
        status: approval !== null ? 'ACTIVE' : 'REJECTED',
        approverUserId,
        decidedAt: approval?.startsAt ?? new Date(),
        decisionNote: note ?? null,
        ...(approval !== null
          ? { startsAt: approval.startsAt, expiresAt: approval.expiresAt, categories: approval.categories }
          : {}),
      },
    });
    return result.count === 1;
  }

  async revokeGrant(tx: Tx, id: string, actorId: string): Promise<boolean> {
    const result = await tx.exceptionalAccessGrant.updateMany({
      where: { id, status: { in: ['PENDING', 'ACTIVE'] }, revokedAt: null },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: actorId },
    });
    return result.count === 1;
  }

  async reviewGrant(tx: Tx, id: string, reviewerId: string, outcome: string): Promise<boolean> {
    const result = await tx.exceptionalAccessGrant.updateMany({
      where: { id, kind: 'EMERGENCY', reviewedAt: null },
      data: { reviewedBy: reviewerId, reviewedAt: new Date(), reviewOutcome: outcome },
    });
    return result.count === 1;
  }

  async createRequest(tx: Tx, data: {
    requesterUserId: string;
    requesterHospitalId: string | null;
    targetHospitalId: string;
    patientId: string;
    recordId: string;
    items: string[];
    reason: string;
  }): Promise<RequestRow> {
    return tx.informationRequest.create({
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
    tx: Tx,
    id: string,
    deciderId: string,
    approved: { items: string[]; expiresAt: Date } | null,
    note: string | undefined,
  ): Promise<boolean> {
    const result = await tx.informationRequest.updateMany({
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

  async revokeRequest(tx: Tx, id: string): Promise<boolean> {
    const result = await tx.informationRequest.updateMany({
      where: { id, status: { in: ['PENDING', 'APPROVED'] }, revokedAt: null },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return result.count === 1;
  }

  // ── lists (XH-05) ─────────────────────────────────────────────────────
  //
  // Metadata only: the same fields the decision routes already return, plus
  // the requester's id and display name and the times. Never the patient,
  // the reason text or any clinical row. Each list is keyed on one
  // dimension the tenant policies already expose to the caller: their own
  // `requester_user_id`, or the admin's own hospital.

  /** The caller's own grants, every status, newest first. */
  async grantsRequestedBy(
    userId: string,
    paging: { skip: number; take: number },
  ): Promise<Page<GrantListRow>> {
    const where = { requesterUserId: userId };
    const [rows, totalItems] = await Promise.all([
      this.prisma.db.exceptionalAccessGrant.findMany({
        where,
        select: { ...GRANT_SELECT, ...LIST_EXTRA },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...paging,
      }),
      this.prisma.db.exceptionalAccessGrant.count({ where }),
    ]);
    return { rows, totalItems };
  }

  /** The caller's own information requests, every status, newest first. */
  async requestsMadeBy(
    userId: string,
    paging: { skip: number; take: number },
  ): Promise<Page<RequestListRow>> {
    const where = { requesterUserId: userId };
    const [rows, totalItems] = await Promise.all([
      this.prisma.db.informationRequest.findMany({
        where,
        select: { ...REQUEST_SELECT, ...LIST_EXTRA },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...paging,
      }),
      this.prisma.db.informationRequest.count({ where }),
    ]);
    return { rows, totalItems };
  }

  /**
   * One hospital's grant queue: `pending` (EXCEPTIONAL awaiting a decision),
   * `active` (live now: ACTIVE, unrevoked, inside the window), `review`
   * (Emergency Overrides not yet reviewed, BG3), oldest first.
   */
  async grantQueue(
    hospitalId: string,
    queue: GrantQueue,
    paging: { skip: number; take: number },
  ): Promise<Page<GrantListRow>> {
    const now = new Date();
    const where =
      queue === 'pending'
        ? { hospitalId, status: 'PENDING' }
        : queue === 'active'
          ? { hospitalId, status: 'ACTIVE', revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } }
          : { hospitalId, kind: 'EMERGENCY', reviewedAt: null };
    const [rows, totalItems] = await Promise.all([
      this.prisma.db.exceptionalAccessGrant.findMany({
        where,
        select: { ...GRANT_SELECT, ...LIST_EXTRA },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...paging,
      }),
      this.prisma.db.exceptionalAccessGrant.count({ where }),
    ]);
    return { rows, totalItems };
  }

  /** One hospital's information-request queue: `pending`, or `approved` and live. */
  async requestQueue(
    hospitalId: string,
    queue: RequestQueue,
    paging: { skip: number; take: number },
  ): Promise<Page<RequestListRow>> {
    const now = new Date();
    const where =
      queue === 'pending'
        ? { targetHospitalId: hospitalId, status: 'PENDING' }
        : { targetHospitalId: hospitalId, status: 'APPROVED', revokedAt: null, shareExpiresAt: { gt: now } };
    const [rows, totalItems] = await Promise.all([
      this.prisma.db.informationRequest.findMany({
        where,
        select: { ...REQUEST_SELECT, ...LIST_EXTRA },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...paging,
      }),
      this.prisma.db.informationRequest.count({ where }),
    ]);
    return { rows, totalItems };
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
