/**
 * Administrative oversight — API §9.11, RM M20.7, ADR-006.
 *
 * > ✅ Verify: content view without an active grant → 403; every granted
 * > view writes an audit row with a ref.
 *
 * ## Content access is a grant, not a capability
 *
 * `communications.viewContent` is necessary and **not sufficient**.
 * ADR-006 §1: content requires the capability *and* an active,
 * justified, time-boxed grant. §5: every view is audited with the
 * grant's `access_ref` — "on **every** content read, not once per
 * grant" — and "no code path returns message content without an audit
 * write in the same transaction". That last clause is why `viewContent`
 * reads the bodies inside `$transaction` alongside the audit write: if
 * the audit write fails, the transaction rolls back and no content is
 * returned.
 *
 * ## The second-admin mode is policy, and both modes are built
 *
 * The project owner decided self-serve plus a complete audit trail on
 * 2026-08-12 (ADR-006, closing RA-006.1), and required the flow stay
 * policy-driven. `COMMUNICATION_REQUIRE_SECOND_ADMIN_APPROVAL` is the
 * env layer M24.2 will put a platform setting over (RA-006.2). Neither
 * mode is hard-coded, and **a request is never self-approved** — that
 * follows from the two-person purpose and holds whichever default is on.
 *
 * ## The grant TTL fails closed, because no source gives one
 *
 * ADR-006 §4 requires `expires_at`; **RA-006.3 records that no source
 * states a duration**, names the 15-minute PHI-reveal window only as a
 * precedent, and says whether it suits message content "is a product
 * question. Not decided." So issuing a grant needs
 * `COMMUNICATION_GRANT_TTL_MINUTES` to be configured, and refuses with
 * 503 when it is not. Choosing a number here would be inventing the most
 * privacy-sensitive timeout in the platform on no evidence — and the
 * platform already fails closed on far less (a prescription cannot be
 * sent when the interaction service is merely unreachable).
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { ConfigService } from '../../../config';
import {
  AUDIT_DISPATCHER,
  TransactionalAuditWriter,
  type AuditDispatcher,
} from '../../../shared/audit';
import { PrismaService } from '../../../shared/database';
import { maskMrn } from '../../../shared/phi';
import type {
  AccessRequestBody,
  OversightQuery,
  ResolveFlagBody,
  FlagQuery,
} from '../dto/oversight.schema';
import { OversightRepository, type GrantRow } from '../repositories/oversight.repository';

/**
 * API §9.11's wire vocabulary ⇄ DB §S4's storage vocabulary.
 *
 * ADR-006 §3: the contract's spelling is preserved on the wire and the
 * mapping to storage is internal. A `Record` in each direction so adding
 * one without the other stops the build.
 */
const CATEGORY_TO_STORAGE = {
  complaint: 'patient_complaint',
  safety: 'safety_flag',
  legal: 'legal_request',
  audit: 'quality_audit',
} as const;

const CATEGORY_TO_WIRE: Record<string, string> = {
  patient_complaint: 'complaint',
  safety_flag: 'safety',
  legal_request: 'legal',
  quality_audit: 'audit',
};

@Injectable()
export class OversightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oversight: OversightRepository,
    private readonly config: ConfigService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    private readonly disclosureAudit: TransactionalAuditWriter,
  ) {}

  /** API §9.11 — metadata only, patient masked. */
  async listConversations(query: OversightQuery) {
    const { rows, totalItems } = await this.oversight.listConversations(
      query.page,
      query.pageSize,
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        topic: row.topic,
        // The MRN is masked by default (M7.3): this list exists so an
        // administrator can find a thread, not so they can learn which
        // patient it is about before justifying why they need to.
        patientMrn: row.patient === null ? null : maskMrn(row.patient.publicId),
        participantCount: row.participants.length,
        messageCount: row._count.messages,
        readOnly: row.readOnly,
        lastActivityAt: row.lastActivityAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /** API §9.11 — request access. Self-serve or pending, by policy. */
  async requestAccess(adminId: string, conversationId: string, body: AccessRequestBody) {
    if ((await this.oversight.conversationExists(conversationId)) === 0) {
      throw AppException.notFound('Conversation not found');
    }

    const ttlMinutes = this.config.env.COMMUNICATION_GRANT_TTL_MINUTES;

    if (ttlMinutes === undefined) {
      // Fail closed: ADR-006 RA-006.3 leaves the duration undecided, and
      // a grant without an expiry contradicts ADR-006 §4.
      throw new AppException(503, {
        message:
          'Content-access grants are not configured: no grant lifetime has been set. See ADR-006 RA-006.3.',
        code: 'service_unavailable',
      });
    }

    const requiresApproval = this.config.env.COMMUNICATION_REQUIRE_SECOND_ADMIN_APPROVAL;
    const now = new Date();
    const accessRef = `CAR-${now.getTime().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;

    const created = await this.oversight.createRequest({
      conversationId,
      requestedBy: adminId,
      justificationCategory: CATEGORY_TO_STORAGE[body.justificationCategory],
      reason: body.reason,
      accessRef,
      // The response shape is identical in both modes and only `status`
      // differs (ADR-006 Consequences), so no client needs a branch.
      ...(requiresApproval
        ? { status: 'pending' }
        : {
            status: 'approved',
            grantedAt: now,
            expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
          }),
    });

    await this.audit.record({
      action: 'communication_access.request',
      actor: { userId: adminId, role: 'administrator' },
      entityType: 'conversation',
      entityId: conversationId,
      metadata: {
        accessRef,
        justificationCategory: body.justificationCategory,
        status: created.status,
      },
    });

    return toGrantView(created);
  }

  /** API §9.11 — the second administrator approves. Never the requester. */
  async approve(adminId: string, requestId: string) {
    const existing = await this.oversight.requestById(requestId);

    if (existing === null) throw AppException.notFound('Access request not found');

    if (existing.requestedBy === adminId) {
      // A self-approved grant is not a second pair of eyes, and ADR-006
      // enforces this "regardless of which default is chosen".
      throw AppException.forbidden('An access request cannot be approved by its requester');
    }

    if (existing.status !== 'pending') {
      throw AppException.conflict('This access request is no longer pending');
    }

    const ttlMinutes = this.config.env.COMMUNICATION_GRANT_TTL_MINUTES;

    if (ttlMinutes === undefined) {
      throw new AppException(503, {
        message:
          'Content-access grants are not configured: no grant lifetime has been set. See ADR-006 RA-006.3.',
        code: 'service_unavailable',
      });
    }

    const now = new Date();
    const moved = await this.oversight.approve(
      requestId,
      adminId,
      now,
      new Date(now.getTime() + ttlMinutes * 60_000),
    );

    if (moved === 0) throw AppException.conflict('This access request is no longer pending');

    await this.audit.record({
      action: 'communication_access.approve',
      actor: { userId: adminId, role: 'administrator' },
      entityType: 'conversation',
      entityId: existing.conversationId,
      metadata: { accessRef: existing.accessRef, requestId },
    });

    const updated = await this.oversight.requestById(requestId);

    return toGrantView(updated ?? existing);
  }

  /**
   * API §9.11 — the watermarked, read-only content view.
   *
   * The audit write and the content read share one transaction. ADR-006
   * §5 requires it in those words, and the consequence it names is the
   * point: "if the audit write fails, no content is returned".
   *
   * That takes `TransactionalAuditWriter`, not the dispatcher. The
   * dispatcher writes on its own connection and swallows a failure, so an
   * earlier revision that called it inside this callback returned the
   * content with no row behind it — the transaction rolled back nothing
   * because the audit write was never part of it. A failed insert now
   * aborts the transaction and the caller gets a 503 `audit_unavailable`.
   */
  async viewContent(adminId: string, conversationId: string, now: Date = new Date()) {
    const grant = await this.oversight.activeGrant(conversationId, adminId, now);

    if (grant === null) {
      throw AppException.forbidden(
        'Viewing message content requires an active access grant.',
        'grant_required',
      );
    }

    const messages = await this.prisma.$transaction(async (tx) => {
      const rows = await this.oversight.contentFor(tx, conversationId);

      await this.disclosureAudit.recordWithin(tx, {
        action: 'communication_access.view',
        actor: { userId: adminId, role: 'administrator' },
        entityType: 'conversation',
        entityId: conversationId,
        // The ref is what the watermark shows, so a screenshot traces
        // back to the request that allowed it (DB §S4's own comment).
        metadata: { accessRef: grant.accessRef, messages: rows.length },
      });

      return rows;
    });

    return {
      accessRef: grant.accessRef,
      // Read-only and watermarked (ADR-006 §6): no edit, no export, no
      // bulk retrieval is offered through this surface.
      readOnly: true,
      watermark: `Medora · ${grant.accessRef} · ${adminId}`,
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      messages: messages.map((message) => ({
        id: message.id,
        authorId: message.authorId,
        body: message.body,
        sentAt: message.sentAt.toISOString(),
        editedAt: message.editedAt?.toISOString() ?? null,
      })),
    };
  }

  /** API §9.11 — the safety-flags queue. */
  async listFlags(query: FlagQuery) {
    const { rows, totalItems } = await this.oversight.listFlags(
      query.status,
      query.page,
      query.pageSize,
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        messageId: row.messageId,
        category: row.category,
        source: row.source,
        // The excerpt is stored on the flag by whoever raised it; the
        // message body is not read here, because that would be a content
        // view without a grant.
        excerpt: row.excerpt,
        status: row.status,
        resolution: row.resolution,
        resolutionNote: row.resolutionNote,
        createdAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /** API §9.11 — resolve a flag. P4: the note is mandatory. */
  async resolveFlag(adminId: string, flagId: string, body: ResolveFlagBody) {
    const existing = await this.oversight.flagById(flagId);

    if (existing === null) throw AppException.notFound('Flag not found');

    const moved = await this.oversight.resolveFlag({
      flagId,
      resolvedBy: adminId,
      resolution: body.resolution,
      note: body.note,
    });

    // Zero means another administrator resolved it between the read and
    // the write — a 409 rather than a silent overwrite of their note.
    if (moved === 0) throw AppException.conflict('This flag has already been resolved');

    await this.audit.record({
      action: 'message_flag.resolve',
      actor: { userId: adminId, role: 'administrator' },
      entityType: 'message_flag',
      entityId: flagId,
      metadata: { resolution: body.resolution },
    });

    const updated = await this.oversight.flagById(flagId);

    return {
      id: flagId,
      status: updated?.status ?? 'resolved',
      resolution: updated?.resolution ?? body.resolution,
    };
  }
}

function toGrantView(row: GrantRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    justificationCategory: CATEGORY_TO_WIRE[row.justificationCategory] ?? row.justificationCategory,
    status: row.status,
    accessRef: row.accessRef,
    grantedAt: row.grantedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}
