/**
 * Exceptional Access (Break-Glass), Emergency Override and cross-hospital
 * information requests (multi-hospital §2.11, §2.12; fix-list items 11–13).
 *
 * ## Exceptional Access / Emergency Override
 *
 * - **Who may request:** a doctor in clinical standing, or an administrator
 *   with a resolved scope (a Hospital Admin only for its own hospital). This
 *   is a dedicated server-side eligibility rule, separate from every matrix
 *   capability: no role holds it implicitly through the permission matrix,
 *   and nothing in the matrix can grant it.
 * - **Every request** names one patient, one hospital, the data categories and
 *   a reason, carries a duration (≤ 24 h), and re-proves the requester's
 *   password through the shared `ReauthenticationPort`.
 * - **EXCEPTIONAL** always waits for an independent approver — the target
 *   hospital's own Hospital Admin, never the requester, never a Platform
 *   Admin (audit F-11; the per-hospital waiver no longer applies). No data
 *   is readable before that, and a hospital with no approver leaves the
 *   request pending.
 * - **EMERGENCY** (Break-Glass) is for doctors in clinical standing only —
 *   never an administrator. It is active at once, notifies the hospital's
 *   administrators, is audited at `critical`, and must be reviewed
 *   retrospectively.
 * - **Reads** happen only through `GET /exceptional-access/:id/data`, by the
 *   requester themselves (no impersonation), within the window, for a
 *   category in scope. Every read is audited with the grant id.
 *
 * ## Information requests
 *
 * - A doctor or an administrator asks another hospital for named items of a
 *   named patient's record, with a reason. Only the **owning hospital's**
 *   Hospital Admin approves or rejects, never a Platform Admin and never the
 *   requester. Approval names a subset of the items and an expiry (≤ 30 days).
 * - Nothing is shared before approval, and only the approved items until
 *   expiry or revocation.
 * - Asking never grants an administrator PHI. The reader must be the
 *   requester **and** a doctor in clinical standing (the clinical-access
 *   rules still apply). Every read is audited.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { MandatoryAuditWriter } from '../../../shared/audit';
import { runAsSystem } from '../../../shared/database';
import {
  AdminScopeService,
  HospitalContextService,
  PermissionResolver,
  ReauthenticationPort,
} from '../../../shared/authz';

import type {
  ApproveExceptionalAccessInput,
  ApproveInformationRequestInput,
  CategoryQuery,
  CreateInformationRequestInput,
  DecisionInput,
  GrantQueueQuery,
  ListQuery,
  RequestExceptionalAccessInput,
  RequestQueueQuery,
  ReviewInput,
} from '../dto/controlled-access.schema';
import {
  ControlledAccessRepository,
  type GrantListRow,
  type GrantRow,
  type Page,
  type RequestListRow,
  type RequestRow,
} from '../repositories/controlled-access.repository';

export interface GrantView {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly hospitalId: string;
  readonly categories: readonly string[];
  readonly startsAt: string | null;
  readonly expiresAt: string | null;
  readonly requiresApproval: boolean;
  readonly reviewOutcome: string | null;
}

export interface InformationRequestView {
  readonly id: string;
  readonly status: string;
  readonly targetHospitalId: string;
  readonly requestedItems: readonly string[];
  readonly approvedItems: readonly string[];
  readonly shareExpiresAt: string | null;
}

/**
 * A list row (XH-05): the same fields as the decision views, plus who asked
 * and when. Metadata only — no patient, no reason text, no clinical data.
 */
export interface GrantListItem extends GrantView {
  readonly requester: { readonly id: string; readonly name: string };
  readonly requestedAt: string;
  readonly decidedAt: string | null;
}

export interface InformationRequestListItem extends InformationRequestView {
  readonly requester: { readonly id: string; readonly name: string };
  readonly requestedAt: string;
  readonly decidedAt: string | null;
}

export interface PageView<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface DataView {
  readonly category: string;
  readonly hospitalId: string;
  readonly data: unknown;
}

const grantView = (row: GrantRow): GrantView => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  hospitalId: row.hospitalId,
  categories: row.categories,
  startsAt: row.startsAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  requiresApproval: row.requiresApproval,
  reviewOutcome: row.reviewOutcome,
});

const requestView = (row: RequestRow): InformationRequestView => ({
  id: row.id,
  status: row.status,
  targetHospitalId: row.targetHospitalId,
  requestedItems: row.requestedItems,
  approvedItems: row.approvedItems,
  shareExpiresAt: row.shareExpiresAt?.toISOString() ?? null,
});

const listExtras = (row: GrantListRow | RequestListRow) => ({
  requester: { id: row.requester.id, name: row.requester.displayName },
  requestedAt: row.createdAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
});

function pageView<R, T>(result: Page<R>, paging: ListQuery, map: (row: R) => T): PageView<T> {
  return {
    items: result.rows.map(map),
    page: paging.page,
    pageSize: paging.pageSize,
    totalItems: result.totalItems,
    totalPages: Math.ceil(result.totalItems / paging.pageSize),
  };
}

const paged = (query: ListQuery) => ({ skip: (query.page - 1) * query.pageSize, take: query.pageSize });


const actorOf = (user: AuthenticatedUser) => ({ userId: user.id, role: user.role, sessionId: user.sessionId });

@Injectable()
export class ControlledAccessService {
  constructor(
    /**
     * Mandatory audit (F-02, XH-09): reads, and every lifecycle change, which
     * is written on the change's own transaction. A failed write refuses the
     * read or rolls the change back (503 `audit_unavailable`).
     */
    private readonly disclosures: MandatoryAuditWriter,
    private readonly access: ControlledAccessRepository,
    private readonly scopes: AdminScopeService,
    private readonly contexts: HospitalContextService,
    private readonly permissions: PermissionResolver,
    private readonly reauth: ReauthenticationPort,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  // ── Exceptional Access / Emergency Override ──────────────────────────

  async requestExceptional(
    user: AuthenticatedUser,
    input: RequestExceptionalAccessInput,
  ): Promise<GrantView> {
    await this.assertMayRequestExceptional(user, input.hospitalId);
    // Break-Glass is a clinician's emergency path (OD-04: "not available to
    // admins"; N-25). An administrator — Platform or Hospital — never
    // obtains immediately active PHI access by being eligible (F-11).
    if (input.kind === 'EMERGENCY' && user.role !== 'doctor') {
      throw AppException.forbidden('Emergency Override is available to doctors only');
    }
    // Re-authentication before anything is created (401 / 429 on failure,
    // with the shared lockout budget).
    await this.reauth.verify(user, input.password);

    // The target hospital's record, read to decide the request (yes/no and
    // its ids) — a trusted lookup across the boundary it governs, so under
    // `system` scope (F-15 reviewed call site). No clinical row is read.
    const record = await runAsSystem(() => this.access.recordAt(input.patientId, input.hospitalId));
    const emergency = input.kind === 'EMERGENCY';
    if (record === null) return this.unmatchedExceptional(user, input);

    // A grant (path 1) is "approved by the target Hospital Admin" (§1,
    // DR-06): always, whatever the hospital's setting, so nothing is
    // readable until an independent approver has acted. A hospital without
    // an approver leaves the request pending: a missing approver is not an
    // approval (F-11). The database refuses an active grant without one.
    const requiresApproval = !emergency;
    // The grant and its audit row commit together (XH-09): an Emergency
    // Override is never active without its ledger row.
    const grant = await this.access.transaction(async (tx) => {
      const created = await this.access.createGrant(tx, {
        kind: input.kind,
        requesterUserId: user.id,
        hospitalId: input.hospitalId,
        patientId: record.patientId,
        recordId: record.recordId,
        categories: input.categories,
        reason: input.reason,
        requiresApproval,
        durationMinutes: input.durationMinutes,
        reauthenticatedAt: new Date(),
        active: !requiresApproval,
      });
      await this.disclosures.recordIn(tx, {
        action: emergency ? 'exceptional_access.emergency_override' : 'exceptional_access.request',
        actor: actorOf(user),
        entityType: 'exceptional_access_grant',
        entityId: created.id,
        hospitalId: input.hospitalId,
        metadata: {
          categories: input.categories.join(' '),
          durationMinutes: input.durationMinutes,
          status: created.status,
          requiresApproval,
        },
      });
      return created;
    });

    if (emergency) {
      // Notification (§2.11): every administrator of the hospital learns of
      // the override at once; the retrospective review follows.
      for (const adminId of await runAsSystem(() => this.access.hospitalAdminIds(input.hospitalId))) {
        await this.activity.record({
          userId: adminId,
          kind: 'security',
          summary: 'An Emergency Override was used at your hospital and needs review',
          detail: grant.id,
        });
      }
    }
    return grantView(grant);
  }

  /**
   * Approval may only narrow the request (XH-01, D1): `categories` a subset
   * of those requested, `endsAt` no later than the requested duration from
   * now. The audit row records requested and approved side by side.
   */
  async approveExceptional(
    user: AuthenticatedUser,
    id: string,
    input: ApproveExceptionalAccessInput,
  ): Promise<GrantView> {
    const grant = await this.assertMayDecideExceptional(user, id);
    const startsAt = new Date();
    const requestedEnd = new Date(startsAt.getTime() + grant.durationMinutes * 60_000);
    const categories = input.categories ?? grant.categories;
    const extra = categories.filter((category) => !grant.categories.includes(category));
    if (extra.length > 0) {
      throw AppException.validation({ categories: [`Not requested: ${extra.join(', ')}`] });
    }
    if (input.endsAt !== undefined && input.endsAt.getTime() <= startsAt.getTime()) {
      throw AppException.validation({ endsAt: ['The end must be in the future'] });
    }
    if (input.endsAt !== undefined && input.endsAt.getTime() > requestedEnd.getTime()) {
      throw AppException.validation({ endsAt: ['An approval cannot extend the requested window'] });
    }
    const expiresAt = input.endsAt ?? requestedEnd;

    await this.access.transaction(async (tx) => {
      if (!(await this.access.decideGrant(tx, grant, user.id, { startsAt, expiresAt, categories }, input.note))) {
        throw AppException.conflict('The request is no longer pending');
      }
      await this.disclosures.recordIn(tx, {
        action: 'exceptional_access.approve',
        actor: actorOf(user),
        entityType: 'exceptional_access_grant',
        entityId: grant.id,
        hospitalId: grant.hospitalId,
        metadata: {
          requestedCategories: grant.categories.join(' '),
          approvedCategories: categories.join(' '),
          requestedEndsAt: requestedEnd.toISOString(),
          approvedEndsAt: expiresAt.toISOString(),
        },
      });
    });
    return grantView(await this.grantOrNotFound(id));
  }

  async rejectExceptional(user: AuthenticatedUser, id: string, input: DecisionInput): Promise<GrantView> {
    const grant = await this.assertMayDecideExceptional(user, id);
    await this.access.transaction(async (tx) => {
      if (!(await this.access.decideGrant(tx, grant, user.id, null, input.note))) {
        throw AppException.conflict('The request is no longer pending');
      }
      await this.disclosures.recordIn(tx, {
        action: 'exceptional_access.reject',
        actor: actorOf(user),
        entityType: 'exceptional_access_grant',
        entityId: grant.id,
        hospitalId: grant.hospitalId,
      });
    });
    return grantView(await this.grantOrNotFound(id));
  }

  async revokeExceptional(user: AuthenticatedUser, id: string): Promise<GrantView> {
    const grant = await this.grantOrNotFound(id);
    const isRequester = grant.requesterUserId === user.id;
    if (!isRequester) await this.assertHospitalAdminOf(user, grant.hospitalId);
    await this.access.transaction(async (tx) => {
      if (!(await this.access.revokeGrant(tx, grant.id, user.id))) {
        throw AppException.conflict('The grant is no longer pending or active');
      }
      await this.disclosures.recordIn(tx, {
        action: 'exceptional_access.revoke',
        actor: actorOf(user),
        entityType: 'exceptional_access_grant',
        entityId: grant.id,
        hospitalId: grant.hospitalId,
      });
    });
    return grantView(await this.grantOrNotFound(id));
  }

  async reviewEmergency(user: AuthenticatedUser, id: string, input: ReviewInput): Promise<GrantView> {
    const grant = await this.grantOrNotFound(id);
    await this.assertHospitalAdminOf(user, grant.hospitalId);
    if (grant.requesterUserId === user.id) throw AppException.forbidden('You cannot review your own override');
    if (grant.kind !== 'EMERGENCY') throw AppException.conflict('Only an Emergency Override is reviewed');
    await this.access.transaction(async (tx) => {
      if (!(await this.access.reviewGrant(tx, grant.id, user.id, input.outcome))) {
        throw AppException.conflict('The override has already been reviewed');
      }
      await this.disclosures.recordIn(tx, {
        action: 'exceptional_access.review',
        actor: actorOf(user),
        entityType: 'exceptional_access_grant',
        entityId: grant.id,
        hospitalId: grant.hospitalId,
        metadata: { outcome: input.outcome },
      });
    });
    return grantView(await this.grantOrNotFound(id));
  }

  /** The one read path under a grant: the requester, in window, in scope. */
  async readUnderGrant(user: AuthenticatedUser, id: string, query: CategoryQuery): Promise<DataView> {
    const grant = await this.grant(id);
    // Not the requester: answered as unknown (no impersonation, no probing).
    if (grant === null || grant.requesterUserId !== user.id) throw AppException.notFound('Grant not found');
    const now = Date.now();
    const live =
      grant.status === 'ACTIVE' &&
      grant.revokedAt === null &&
      grant.startsAt !== null &&
      grant.expiresAt !== null &&
      grant.startsAt.getTime() <= now &&
      grant.expiresAt.getTime() > now;
    // Pending, rejected, revoked, past its window, or outside its
    // categories: the grant discloses nothing, and says so the way an
    // unknown id does (BG4 / N-27: "subsequent requests 404"; N-3, N-26).
    if (!live || !grant.categories.includes(query.category)) throw AppException.notFound('Grant not found');
    // The requester must still be eligible at the moment of the read.
    await this.assertMayRequestExceptional(user, grant.hospitalId);

    const data = await this.access.read(query.category, grant.patientId, grant.hospitalId);
    await this.disclosures.record({
      action: 'exceptional_access.read',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'exceptional_access_grant',
      entityId: grant.id,
      hospitalId: grant.hospitalId,
      metadata: { category: query.category, kind: grant.kind },
    });
    return { category: query.category, hospitalId: grant.hospitalId, data };
  }

  // ── Cross-hospital information requests ──────────────────────────────

  async createInformationRequest(
    user: AuthenticatedUser,
    input: CreateInformationRequestInput,
  ): Promise<InformationRequestView> {
    const requesterHospitalId = await this.requesterHospital(user);
    if (requesterHospitalId !== null && requesterHospitalId === input.targetHospitalId) {
      throw AppException.validation({ targetHospitalId: ['Request another hospital’s information'] });
    }
    const record = await runAsSystem(() => this.access.recordAt(input.patientId, input.targetHospitalId));
    if (record === null) return this.unmatchedRequest(user, input, requesterHospitalId);

    const request = await this.access.transaction(async (tx) => {
      const created = await this.access.createRequest(tx, {
        requesterUserId: user.id,
        requesterHospitalId,
        targetHospitalId: input.targetHospitalId,
        patientId: record.patientId,
        recordId: record.recordId,
        items: input.items,
        reason: input.reason,
      });
      await this.disclosures.recordIn(tx, {
        action: 'information_request.create',
        actor: actorOf(user),
        entityType: 'information_request',
        entityId: created.id,
        hospitalId: input.targetHospitalId,
        metadata: { items: input.items.join(' '), requesterHospitalId: requesterHospitalId ?? 'platform' },
      });
      return created;
    });
    return requestView(request);
  }

  async approveInformationRequest(
    user: AuthenticatedUser,
    id: string,
    input: ApproveInformationRequestInput,
  ): Promise<InformationRequestView> {
    const request = await this.requestOrNotFound(id);
    await this.assertOwningHospitalAdmin(user, request);
    const extra = input.approvedItems.filter((item) => !request.requestedItems.includes(item));
    if (extra.length > 0) {
      throw AppException.validation({ approvedItems: [`Not requested: ${extra.join(', ')}`] });
    }
    const now = Date.now();
    const shareEnd = new Date(now + input.shareDays * 86_400_000);
    // An earlier end only narrows the share (XH-01); it never extends it.
    if (input.endsAt !== undefined && input.endsAt.getTime() <= now) {
      throw AppException.validation({ endsAt: ['The end must be in the future'] });
    }
    if (input.endsAt !== undefined && input.endsAt.getTime() > shareEnd.getTime()) {
      throw AppException.validation({ endsAt: ['The end must fall within shareDays'] });
    }
    const expiresAt = input.endsAt ?? shareEnd;
    await this.access.transaction(async (tx) => {
      const decided = await this.access.decideRequest(
        tx,
        request.id,
        user.id,
        { items: input.approvedItems, expiresAt },
        input.note,
      );
      if (!decided) throw AppException.conflict('The request is no longer pending');
      await this.disclosures.recordIn(tx, {
        action: 'information_request.approve',
        actor: actorOf(user),
        entityType: 'information_request',
        entityId: request.id,
        hospitalId: request.targetHospitalId,
        metadata: {
          requestedItems: request.requestedItems.join(' '),
          approvedItems: input.approvedItems.join(' '),
          shareDays: input.shareDays,
          approvedEndsAt: expiresAt.toISOString(),
        },
      });
    });
    return requestView(await this.requestOrNotFound(id));
  }

  async rejectInformationRequest(
    user: AuthenticatedUser,
    id: string,
    input: DecisionInput,
  ): Promise<InformationRequestView> {
    const request = await this.requestOrNotFound(id);
    await this.assertOwningHospitalAdmin(user, request);
    await this.access.transaction(async (tx) => {
      if (!(await this.access.decideRequest(tx, request.id, user.id, null, input.note))) {
        throw AppException.conflict('The request is no longer pending');
      }
      await this.disclosures.recordIn(tx, {
        action: 'information_request.reject',
        actor: actorOf(user),
        entityType: 'information_request',
        entityId: request.id,
        hospitalId: request.targetHospitalId,
      });
    });
    return requestView(await this.requestOrNotFound(id));
  }

  async revokeInformationRequest(user: AuthenticatedUser, id: string): Promise<InformationRequestView> {
    const request = await this.requestOrNotFound(id);
    if (request.requesterUserId !== user.id) await this.assertOwningHospitalAdmin(user, request, true);
    await this.access.transaction(async (tx) => {
      if (!(await this.access.revokeRequest(tx, request.id))) {
        throw AppException.conflict('The request is no longer pending or approved');
      }
      await this.disclosures.recordIn(tx, {
        action: 'information_request.revoke',
        actor: actorOf(user),
        entityType: 'information_request',
        entityId: request.id,
        hospitalId: request.targetHospitalId,
      });
    });
    return requestView(await this.requestOrNotFound(id));
  }

  async readShared(user: AuthenticatedUser, id: string, query: CategoryQuery): Promise<DataView> {
    const request = await this.access.request(id);
    if (request === null || request.requesterUserId !== user.id) {
      throw AppException.notFound('Request not found');
    }
    const live =
      request.status === 'APPROVED' &&
      request.revokedAt === null &&
      request.shareExpiresAt !== null &&
      request.shareExpiresAt.getTime() > Date.now();
    // Pending, rejected, revoked, expired, or an item not approved: nothing
    // is shared, answered as unknown (BG4 / N-5, N-3).
    if (!live || !request.approvedItems.includes(query.category)) throw AppException.notFound('Request not found');
    // The clinical-access rules still apply to the reader (§2.12): asking
    // never gives an administrator PHI.
    if (user.role !== 'doctor' || (await this.permissions.standingFor(user.id, user.role)) !== 'clinical') {
      throw AppException.forbidden('Only a clinician may read shared clinical information');
    }

    const data = await this.access.read(query.category, request.patientId, request.targetHospitalId);
    await this.disclosures.record({
      action: 'information_request.read',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'information_request',
      entityId: request.id,
      hospitalId: request.targetHospitalId,
      metadata: { item: query.category },
    });
    return { category: query.category, hospitalId: request.targetHospitalId, data };
  }

  // ── lists (XH-05) ────────────────────────────────────────────────────

  /** The caller's own grants, every status (the requester's view). */
  async myGrants(user: AuthenticatedUser, query: ListQuery): Promise<PageView<GrantListItem>> {
    const page = await this.access.grantsRequestedBy(user.id, paged(query));
    return pageView(page, query, (row) => ({ ...grantView(row), ...listExtras(row) }));
  }

  /** The caller's own information requests, every status. */
  async myRequests(user: AuthenticatedUser, query: ListQuery): Promise<PageView<InformationRequestListItem>> {
    const page = await this.access.requestsMadeBy(user.id, paged(query));
    return pageView(page, query, (row) => ({ ...requestView(row), ...listExtras(row) }));
  }

  /**
   * The target Hospital Admin's grant queue: pending approvals, active
   * grants, and the Emergency Override review queue (BG3). Only for the
   * admin's own hospital; the hospital is the admin's scope, never a
   * parameter.
   */
  async grantQueue(user: AuthenticatedUser, query: GrantQueueQuery): Promise<PageView<GrantListItem>> {
    const hospitalId = await this.ownHospital(user);
    const page = await this.access.grantQueue(hospitalId, query.view, paged(query));
    return pageView(page, query, (row) => ({ ...grantView(row), ...listExtras(row) }));
  }

  async requestQueue(
    user: AuthenticatedUser,
    query: RequestQueueQuery,
  ): Promise<PageView<InformationRequestListItem>> {
    const hospitalId = await this.ownHospital(user);
    const page = await this.access.requestQueue(hospitalId, query.view, paged(query));
    return pageView(page, query, (row) => ({ ...requestView(row), ...listExtras(row) }));
  }

  /**
   * The queues belong to the hospital's own Hospital Admin, the only one who
   * may act on them (F-11). A Platform Admin decides nothing here and is
   * given no cross-hospital list of who is reaching which hospital.
   */
  private async ownHospital(user: AuthenticatedUser): Promise<string> {
    const scope = await this.scopes.scopeOf(user);
    if (scope.kind === 'hospital') return scope.hospitalId;
    throw AppException.forbidden('Only a Hospital Admin works its hospital’s queue');
  }

  // ── rules ────────────────────────────────────────────────────────────

  private async assertMayDecideExceptional(user: AuthenticatedUser, id: string): Promise<GrantRow> {
    const grant = await this.grantOrNotFound(id);
    // An independent approver: never the requester (also a CHECK). The
    // requester knows the grant exists, so they are told why.
    if (grant.requesterUserId === user.id) throw AppException.forbidden('You cannot decide your own request');
    await this.assertHospitalAdminOf(user, grant.hospitalId);
    return grant;
  }

  /**
   * A request naming a patient with no record at the target hospital
   * (XH-08). It is audited — a requester probing hospitals for a patient
   * leaves a trace — and then refused with the same 404 as before.
   *
   * Not a decoy `201`: answering "pending" for a request that can never be
   * stored, approved or read would be a misleading success, and a clinician
   * would wait on access that does not exist. A uniform answer needs the
   * request to be storable without a record (nullable
   * `hospital_medical_record_id` plus a CHECK that ACTIVE/APPROVED requires
   * one) — a Database dependency, recorded in the execution progress report.
   */
  private async unmatchedExceptional(
    user: AuthenticatedUser,
    input: RequestExceptionalAccessInput,
  ): Promise<never> {
    await this.disclosures.record({
      action: 'exceptional_access.request_unmatched',
      actor: actorOf(user),
      entityType: 'exceptional_access_grant',
      entityId: 'none',
      // Attributed to the requester's own context, not the target: the
      // target hospital holds no row to tie it to (and the caller's tenant
      // context may not append to another hospital's history).
      metadata: {
        kind: input.kind,
        targetHospitalId: input.hospitalId,
        categories: input.categories.join(' '),
        durationMinutes: input.durationMinutes,
      },
    });
    throw AppException.notFound('Patient not found');
  }

  /** The same, for information requests: audited, then the same 404. */
  private async unmatchedRequest(
    user: AuthenticatedUser,
    input: CreateInformationRequestInput,
    requesterHospitalId: string | null,
  ): Promise<never> {
    await this.disclosures.record({
      action: 'information_request.create_unmatched',
      actor: actorOf(user),
      entityType: 'information_request',
      entityId: 'none',
      metadata: {
        targetHospitalId: input.targetHospitalId,
        items: input.items.join(' '),
        requesterHospitalId: requesterHospitalId ?? 'platform',
      },
    });
    throw AppException.notFound('Patient not found');
  }

  /** Eligibility for Break-Glass (see the header). */
  private async assertMayRequestExceptional(user: AuthenticatedUser, hospitalId: string): Promise<void> {
    if (user.role === 'doctor') {
      if ((await this.permissions.standingFor(user.id, user.role)) === 'clinical') return;
      throw AppException.forbidden('Exceptional Access requires clinical standing');
    }
    if (user.role === 'admin') {
      const scope = await this.scopes.scopeOf(user);
      if (scope.kind === 'platform') return;
      if (scope.kind === 'hospital' && scope.hospitalId === hospitalId) return;
    }
    throw AppException.forbidden('Not eligible for Exceptional Access');
  }

  /**
   * Only the hospital's own Hospital Admin (never a Platform Admin). Anyone
   * else gets the same 404 as an unknown id — the answer Row-Level Security
   * gives too, since the row is not theirs to see — so the response never
   * confirms that a grant or request exists.
   */
  private async assertHospitalAdminOf(user: AuthenticatedUser, hospitalId: string): Promise<void> {
    const scope = await this.scopes.scopeOf(user);
    if (scope.kind === 'hospital' && scope.hospitalId === hospitalId) return;
    throw AppException.notFound('Not found');
  }

  private async assertOwningHospitalAdmin(
    user: AuthenticatedUser,
    request: RequestRow,
    allowRequester = false,
  ): Promise<void> {
    if (!allowRequester && request.requesterUserId === user.id) {
      throw AppException.forbidden('You cannot decide your own request');
    }
    await this.assertHospitalAdminOf(user, request.targetHospitalId);
  }

  /** The hospital a requester asks from: theirs, or `null` for platform. */
  private async requesterHospital(user: AuthenticatedUser): Promise<string | null> {
    if (user.role === 'doctor') {
      if ((await this.permissions.standingFor(user.id, user.role)) !== 'clinical') {
        throw AppException.forbidden('Requesting information requires clinical standing');
      }
      const context = await this.contexts.forRequest(user);
      if (context.kind !== 'hospital') throw AppException.forbidden('No hospital context');
      return context.hospitalId;
    }
    if (user.role === 'admin') {
      const scope = await this.scopes.scopeOf(user);
      if (scope.kind === 'hospital') return scope.hospitalId;
      if (scope.kind === 'platform') return null;
    }
    throw AppException.forbidden('Not eligible to request information');
  }

  private grant(id: string): Promise<GrantRow | null> {
    return this.access.grant(id);
  }

  private async grantOrNotFound(id: string): Promise<GrantRow> {
    const grant = await this.access.grant(id);
    if (grant === null) throw AppException.notFound('Grant not found');
    return grant;
  }

  private async requestOrNotFound(id: string): Promise<RequestRow> {
    const request = await this.access.request(id);
    if (request === null) throw AppException.notFound('Request not found');
    return request;
  }
}
