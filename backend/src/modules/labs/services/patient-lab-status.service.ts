/**
 * `GET /me/lab-orders` — the patient-facing information layer for lab tests
 * (contract §4; owner decision 2026-11-26, ADR-050 draft).
 *
 * A patient sees that a test was ordered and where it is in the pipeline —
 * never what it found. The status vocabulary is collapsed to four
 * patient-meaningful states, and `results` is a fixed marker until a release
 * policy (ADR-031, still proposed) says otherwise.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import type { LabStatus } from '../../../generated/prisma/enums';
import { PatientSelfScopeService, principalOf } from '../../../shared/authz';
import { labCategoryToWire, labSpecimenTypeToWire } from '../dto/labs-enums';
import type {
  PatientLabOrderPage,
  PatientLabOrderView,
  PatientLabStatus,
} from '../dto/patient-lab-status.dto';
import type { PatientLabStatusQuery } from '../dto/patient-lab-status.schema';
import {
  PatientLabStatusRepository,
  type PatientLabStatusRow,
} from '../repositories/patient-lab-status.repository';

/** The contract's exact mapping. */
export const PATIENT_LAB_STATUS: Readonly<Record<LabStatus, PatientLabStatus>> = {
  ORDERED: 'awaiting_collection',
  COLLECTED: 'in_progress',
  PROCESSING: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

@Injectable()
export class PatientLabStatusService {
  constructor(
    private readonly orders: PatientLabStatusRepository,
    private readonly scope: PatientSelfScopeService,
  ) {}

  async listOwn(user: AuthenticatedUser, query: PatientLabStatusQuery): Promise<PatientLabOrderPage> {
    if (user.role !== 'patient') {
      throw AppException.forbidden('This route is available to patient accounts only', 'patient_only');
    }
    const patientPublicId = await this.scope.patientIdFor(principalOf(user));
    if (patientPublicId === null) {
      throw AppException.conflict(
        'This account is not linked to a patient record yet',
        'patient_not_linked',
      );
    }

    const { rows, totalItems } = await this.orders.page(patientPublicId, query.page, query.pageSize);
    const names = await this.orders.hospitalNames(
      rows.flatMap((row) => (row.hospitalId === null ? [] : [row.hospitalId])),
    );

    return {
      items: rows.map((row) => toView(row, names)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}

/** Built field by field — nothing is spread from the row. */
export function toView(
  row: PatientLabStatusRow,
  names: ReadonlyMap<string, string>,
): PatientLabOrderView {
  const name = row.hospitalId === null ? undefined : names.get(row.hospitalId);
  return {
    id: row.publicId,
    testName: row.test.name,
    category: labCategoryToWire(row.test.category),
    specimenType: labSpecimenTypeToWire(row.test.specimenType),
    status: PATIENT_LAB_STATUS[row.status],
    requestedAt: row.requestedAt.toISOString(),
    collectedAt: row.collectedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    hospital: row.hospitalId === null || name === undefined ? null : { id: row.hospitalId, name },
    results: { available: false, reason: 'release_policy_pending' },
  };
}
