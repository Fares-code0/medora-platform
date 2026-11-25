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
import { AUDIT_DISPATCHER, type AuditDispatcher, MandatoryAuditWriter } from '../../../shared/audit';
import { runAsSystem } from '../../../shared/database';
import {
  AdminScopeService,
  HospitalContextService,
  PermissionResolver,
  ReauthenticationPort,
} from '../../../shared/authz';
import type {
  ApproveInformationRequestInput,
  CategoryQuery,
  CreateInformationRequestInput,
  DecisionInput,
  RequestExceptionalAccessInput,
  ReviewInput,
} from '../dto/controlled-access.schema';
import {
  ControlledAccessRepository,
  type GrantRow,
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

@Injectable()
export class ControlledAccessService {
  constructor(
    /** Mandatory audit of disclosures: a failed write refuses the read (F-02). */
    private readonly disclosures: MandatoryAuditWriter,
    private readonly access: ControlledAccessRepository,
    private readonly scopes: AdminScopeService,
    private readonly contexts: HospitalContextService,
    private readonly permissions: PermissionResolver,
    private readonly reauth: ReauthenticationPort,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
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
    if (record === null) throw AppException.notFound('Patient not found');

    const emergency = input.kind === 'EMERGENCY';
    // A grant (path 1) is "approved by the target Hospital Admin" (§1,
    // DR-06): always, whatever the hospital's setting, so nothing is
    // readable until an independent approver has acted. A hospital without
    // an approver leaves the request pending: a missing approver is not an
    // approval (F-11). The database refuses an active grant without one.
    const requiresApproval = !emergency;
    const grant = await this.access.createGrant({
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

    await this.audit.record({
      action: emergency ? 'exceptional_access.emergency_override' : 'exceptional_access.request',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'exceptional_access_grant',
      entityId: grant.id,
      hospitalId: input.hospitalId,
      metadata: {
        categories: input.categories.join(' '),
        durationMinutes: input.durationMinutes,
        status: grant.status,
        requiresApproval,
      },
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

  async approveExceptional(user: AuthenticatedUser, id: string, input: DecisionInput): Promise<GrantView> {
    return this.decideExceptional(user, id, true, input);
  }

  async rejectExceptional(user: AuthenticatedUser, id: string, input: DecisionInput): Promise<GrantView> {
    return this.decideExceptional(user, id, false, input);
  }

  async revokeExceptional(user: AuthenticatedUser, id: string): Promise<GrantView> {
    const grant = await this.grantOrNotFound(id);
    const isRequester = grant.requesterUserId === user.id;
    if (!isRequester) await this.assertHospitalAdminOf(user, grant.hospitalId);
    if (!(await this.access.revokeGrant(grant.id, user.id))) {
      throw AppException.conflict('The grant is no longer pending or active');
    }
    await this.audit.record({
      action: 'exceptional_access.revoke',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'exceptional_access_grant',
      entityId: grant.id,
      hospitalId: grant.hospitalId,
    });
    return grantView(await this.grantOrNotFound(id));
  }

  async reviewEmergency(user: AuthenticatedUser, id: string, input: ReviewInput): Promise<GrantView> {
    const grant = await this.grantOrNotFound(id);
    await this.assertHospitalAdminOf(user, grant.hospitalId);
    if (grant.requesterUserId === user.id) throw AppException.forbidden('You cannot review your own override');
    if (grant.kind !== 'EMERGENCY') throw AppException.conflict('Only an Emergency Override is reviewed');
    if (!(await this.access.reviewGrant(grant.id, user.id, input.outcome))) {
      throw AppException.conflict('The override has already been reviewed');
    }
    await this.audit.record({
      action: 'exceptional_access.review',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'exceptional_access_grant',
      entityId: grant.id,
      hospitalId: grant.hospitalId,
      metadata: { outcome: input.outcome },
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
    if (!live) throw AppException.forbidden('The grant is not active');
    if (!grant.categories.includes(query.category)) {
      throw AppException.forbidden('The category is outside the grant');
    }
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
    if (record === null) throw AppException.notFound('Patient not found');

    const request = await this.access.createRequest({
      requesterUserId: user.id,
      requesterHospitalId,
      targetHospitalId: input.targetHospitalId,
      patientId: record.patientId,
      recordId: record.recordId,
      items: input.items,
      reason: input.reason,
    });
    await this.audit.record({
      action: 'information_request.create',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'information_request',
      entityId: request.id,
      hospitalId: input.targetHospitalId,
      metadata: { items: input.items.join(' '), requesterHospitalId: requesterHospitalId ?? 'platform' },
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
    const expiresAt = new Date(Date.now() + input.shareDays * 86_400_000);
    if (!(await this.access.decideRequest(request.id, user.id, { items: input.approvedItems, expiresAt }, input.note))) {
      throw AppException.conflict('The request is no longer pending');
    }
    await this.audit.record({
      action: 'information_request.approve',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'information_request',
      entityId: request.id,
      hospitalId: request.targetHospitalId,
      metadata: { approvedItems: input.approvedItems.join(' '), shareDays: input.shareDays },
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
    if (!(await this.access.decideRequest(request.id, user.id, null, input.note))) {
      throw AppException.conflict('The request is no longer pending');
    }
    await this.audit.record({
      action: 'information_request.reject',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'information_request',
      entityId: request.id,
      hospitalId: request.targetHospitalId,
    });
    return requestView(await this.requestOrNotFound(id));
  }

  async revokeInformationRequest(user: AuthenticatedUser, id: string): Promise<InformationRequestView> {
    const request = await this.requestOrNotFound(id);
    if (request.requesterUserId !== user.id) await this.assertOwningHospitalAdmin(user, request, true);
    if (!(await this.access.revokeRequest(request.id))) {
      throw AppException.conflict('The request is no longer pending or approved');
    }
    await this.audit.record({
      action: 'information_request.revoke',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'information_request',
      entityId: request.id,
      hospitalId: request.targetHospitalId,
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
    if (!live) throw AppException.forbidden('Nothing is shared under this request');
    if (!request.approvedItems.includes(query.category)) {
      throw AppException.forbidden('The item was not approved');
    }
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

  // ── rules ────────────────────────────────────────────────────────────

  private async decideExceptional(
    user: AuthenticatedUser,
    id: string,
    approve: boolean,
    input: DecisionInput,
  ): Promise<GrantView> {
    const grant = await this.grantOrNotFound(id);
    // An independent approver: never the requester (also a CHECK). The
    // requester knows the grant exists, so they are told why.
    if (grant.requesterUserId === user.id) throw AppException.forbidden('You cannot decide your own request');
    await this.assertHospitalAdminOf(user, grant.hospitalId);
    if (!(await this.access.decideGrant(grant, user.id, approve, input.note))) {
      throw AppException.conflict('The request is no longer pending');
    }
    await this.audit.record({
      action: approve ? 'exceptional_access.approve' : 'exceptional_access.reject',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'exceptional_access_grant',
      entityId: grant.id,
      hospitalId: grant.hospitalId,
    });
    return grantView(await this.grantOrNotFound(id));
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
