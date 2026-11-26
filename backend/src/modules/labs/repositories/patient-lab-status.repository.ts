/**
 * The patient's own lab orders, status columns only (contract §4).
 *
 * The `select` is explicit and never spread: `clinical_indication`,
 * `interpretation`, `has_critical_result`, the reviewer and every result row
 * are simply not read, so they cannot reach the wire by a later refactor of
 * the mapper. Soft-deleted rows and legacy rows with no `hospital_id` (#17)
 * are excluded in the query.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

const STATUS_SELECT = {
  publicId: true,
  status: true,
  requestedAt: true,
  collectedAt: true,
  completedAt: true,
  hospitalId: true,
  test: { select: { name: true, category: true, specimenType: true } },
} satisfies Prisma.LabOrderSelect;

export type PatientLabStatusRow = Prisma.LabOrderGetPayload<{ select: typeof STATUS_SELECT }>;

@Injectable()
export class PatientLabStatusRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `patientPublicId` is the `PT-…` handle `PatientSelfScopeService` resolves. */
  async page(
    patientPublicId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: readonly PatientLabStatusRow[]; totalItems: number }> {
    const where = {
      patient: { is: { publicId: patientPublicId } },
      deletedAt: null,
      NOT: [{ hospitalId: null }],
    } satisfies Prisma.LabOrderWhereInput;
    const [rows, totalItems] = await Promise.all([
      this.prisma.db.labOrder.findMany({
        where,
        select: STATUS_SELECT,
        orderBy: [{ requestedAt: 'desc' }, { publicId: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.labOrder.count({ where }),
    ]);
    return { rows, totalItems };
  }

  /** Hospital names for a page — the directory every scope may read. */
  async hospitalNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.db.hospital.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
