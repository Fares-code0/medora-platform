import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import type { Prisma } from '../../../generated/prisma/client';
import type { RecordIssueStatus } from '../dto/record-issue.schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `record_issue_reports` for the administrators' queue (RM M12.7).
 *
 * The projection reaches the record for its **reference** and the patient
 * for its **`PT-…` handle** only. API §0.4 masks administrator patient
 * projections; the queue needs to say *which* chart, not *whose* — and an
 * administrator who needs the identity has the audited reveal (M7.3).
 */
const ISSUE_SELECT = {
  id: true,
  status: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  record: {
    select: {
      publicId: true,
      status: true,
      visitDate: true,
      department: { select: { name: true } },
      patient: { select: { publicId: true } },
    },
  },
  reporter: { select: { publicId: true, displayName: true } },
  resolver: { select: { publicId: true, displayName: true } },
} satisfies Prisma.RecordIssueReportSelect;

export type RecordIssueRow = Prisma.RecordIssueReportGetPayload<{ select: typeof ISSUE_SELECT }>;

export interface RecordIssueCriteria {
  readonly status: RecordIssueStatus | undefined;
  readonly sort: 'reportedAt:asc' | 'reportedAt:desc';
  readonly page: number;
  readonly pageSize: number;
}

@Injectable()
export class RecordIssueRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    criteria: RecordIssueCriteria,
  ): Promise<{ rows: readonly RecordIssueRow[]; totalItems: number }> {
    const where: Prisma.RecordIssueReportWhereInput =
      criteria.status === undefined ? {} : { status: criteria.status };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.recordIssueReport.findMany({
        where,
        select: ISSUE_SELECT,
        // `id` breaks ties, so two reports filed in the same millisecond
        // cannot swap places between page 1 and page 2.
        orderBy: [
          { createdAt: criteria.sort === 'reportedAt:asc' ? 'asc' : 'desc' },
          { id: 'asc' },
        ],
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.recordIssueReport.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /** One issue, or `null` — a malformed id is a missing one, not a 500. */
  find(id: string): Promise<RecordIssueRow | null> {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.recordIssueReport.findUnique({ where: { id }, select: ISSUE_SELECT });
  }

  /**
   * Compare-and-set on the status the caller read.
   *
   * Two administrators triaging the same issue at once produce one
   * transition and one `false`, rather than the second silently
   * overwriting the first — and the row count, not a re-read, decides.
   */
  async transition(input: {
    readonly id: string;
    readonly from: RecordIssueStatus;
    readonly to: RecordIssueStatus;
    readonly actorId: string;
  }): Promise<boolean> {
    const resolving = input.to === 'resolved';

    const updated = await this.prisma.db.recordIssueReport.updateMany({
      where: { id: input.id, status: input.from },
      data: {
        status: input.to,
        ...(resolving ? { resolvedBy: input.actorId, resolvedAt: new Date() } : {}),
      },
    });

    return updated.count === 1;
  }
}
