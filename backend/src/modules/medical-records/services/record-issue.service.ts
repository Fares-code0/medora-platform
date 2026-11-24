/**
 * The administrators' record-issue queue (API §6.9 "flag data error →
 * admin queue", RM M12.7 — "the admin queue UI/endpoint is M23").
 *
 * `POST /medical-records/{id}/report-issue` has written `open` rows since
 * M12.7; nothing read them, so a clinician's report of a wrong chart went
 * into a table no screen could show. This is the read and the one write a
 * queue needs: list it, take an item (`investigating`), close it
 * (`resolved`).
 *
 * ## The lifecycle is a machine, not a field
 *
 * `open → investigating → resolved`, with `open → resolved` for the item
 * that needs no investigation. `resolved` is terminal — a recurrence is a
 * new report, which keeps the first one's resolution on the record. The
 * shared status kernel (RM M2.3) raises the 409, and the write is a
 * compare-and-set on the status read, so two administrators taking the
 * same item produce one 200 and one 409.
 *
 * ## What an administrator sees
 *
 * The record's reference and status, the patient's `PT-…` handle and no
 * identity field (API §0.4 masks administrator projections), the
 * reporter's name, and the description — which is the report itself, the
 * text the clinician wrote *for* this queue. It is not copied into the
 * ledger or the notification: both carry ids only.
 *
 * ## Who
 *
 * `@Roles('admin')` on the controller, as for every M23 administration
 * route ("All routes: admin role"). The capability matrix has no
 * data-quality capability, and inventing one would change the frontend's
 * permission parity (`features/admin/permissions.ts`) for a queue the
 * frontend does not render yet.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { TenantContextResolver } from '../../../shared/authz';
import { runAsSystem } from '../../../shared/database';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { defineStatusMachine } from '../../../shared/status';
import { recordStatusToWire } from '../dto/record-enums';
import type {
  RecordIssueListQuery,
  RecordIssueStatus,
  UpdateRecordIssueInput,
} from '../dto/record-issue.schema';
import {
  RecordIssueRepository,
  type RecordIssueRow,
} from '../repositories/record-issue.repository';

export interface RecordIssuePartyView {
  /** `users.public_id`. */
  readonly id: string;
  readonly name: string;
}

export interface RecordIssueView {
  readonly id: string;
  readonly status: RecordIssueStatus;
  readonly description: string;
  readonly record: {
    readonly id: string;
    readonly status: string;
    readonly visitDate: string;
    readonly department: string | null;
  };
  /** The `PT-…` handle — never a name or an MRN. */
  readonly patientId: string;
  readonly reportedBy: RecordIssuePartyView | null;
  readonly reportedAt: string;
  readonly resolvedBy: RecordIssuePartyView | null;
  readonly resolvedAt: string | null;
  readonly updatedAt: string;
  /** Server-computed (API §5's rule for actions): the legal next statuses. */
  readonly availableActions: readonly RecordIssueStatus[];
}

export interface PaginatedRecordIssues {
  readonly items: readonly RecordIssueView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export const recordIssueMachine = defineStatusMachine<RecordIssueStatus>('Record issue', {
  open: ['investigating', 'resolved'],
  investigating: ['resolved'],
  resolved: [],
});

@Injectable()
export class RecordIssueService {
  constructor(
    private readonly issues: RecordIssueRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    private readonly tenants: TenantContextResolver,
  ) {}

  /**
   * The reviewer's hospital (F-01, OD-07). Record quality review is a
   * hospital function: a Platform Admin holds no clinical access, so a
   * caller without a hospital is refused rather than shown every
   * hospital's (or, under RLS, no) issues.
   */
  private async hospitalOf(user: AuthenticatedUser): Promise<string> {
    const tenant = await runAsSystem(() => this.tenants.resolve(user));
    if (tenant?.scope === 'hospital' && tenant.hospitalId !== undefined) return tenant.hospitalId;
    throw AppException.forbidden('Record issue review is a hospital function', 'hospital_scope_required');
  }

  async list(user: AuthenticatedUser, query: RecordIssueListQuery): Promise<PaginatedRecordIssues> {
    const { rows, totalItems } = await this.issues.list({
      hospitalId: await this.hospitalOf(user),
      status: query.status,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });

    return {
      items: rows.map(toView),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateRecordIssueInput,
  ): Promise<RecordIssueView> {
    const hospitalId = await this.hospitalOf(user);
    const current = await this.issues.find(id, hospitalId);
    if (current === null) throw AppException.notFound('Record issue not found');

    const from = asStatus(current.status);
    recordIssueMachine.assert(from, input.status);

    const moved = await this.issues.transition({
      id: current.id,
      from,
      to: input.status,
      actorId: user.id,
    });

    // Lost the race: someone else moved it between the read and the write.
    // Re-read so the 409 names the status it is actually in now.
    if (!moved) {
      const now = await this.issues.find(id, hospitalId);
      const status = now === null ? from : asStatus(now.status);
      throw AppException.conflict(
        `Record issue is now ${status}; reload the queue`,
        'invalid_status_transition',
      );
    }

    await this.audit.record({
      action: input.status === 'resolved' ? 'record_issue.resolve' : 'record_issue.investigate',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'record_issue',
      entityId: current.id,
      metadata: { from, to: input.status, recordId: current.record.publicId },
    });

    const updated = await this.issues.find(id, hospitalId);
    if (updated === null) throw AppException.notFound('Record issue not found');

    return toView(updated);
  }
}

function asStatus(value: string): RecordIssueStatus {
  // The column is closed by a CHECK to these three; anything else is a
  // database that disagrees with its own constraint.
  if (value === 'open' || value === 'investigating' || value === 'resolved') return value;
  throw new Error(`record_issue_reports.status holds an unknown value`);
}

function party(
  row: { readonly publicId: string; readonly displayName: string } | null,
): RecordIssuePartyView | null {
  return row === null ? null : { id: row.publicId, name: row.displayName };
}

function toView(row: RecordIssueRow): RecordIssueView {
  const status = asStatus(row.status);

  return {
    id: row.id,
    status,
    description: row.description,
    record: {
      id: row.record.publicId,
      status: recordStatusToWire(row.record.status),
      visitDate: row.record.visitDate.toISOString(),
      department: row.record.department?.name ?? null,
    },
    patientId: row.record.patient.publicId,
    reportedBy: party(row.reporter),
    reportedAt: row.createdAt.toISOString(),
    resolvedBy: party(row.resolver),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    availableActions: recordIssueMachine.allowedFrom(status),
  };
}
