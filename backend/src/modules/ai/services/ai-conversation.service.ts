/**
 * Conversation CRUD (RM M16.2, API §11.1–§11.2).
 *
 * > ✅ Verify: CRUD round-trip matches `features/doctor/ai/model/types.ts`;
 * > delete is soft (row survives).
 *
 * ## Ownership, not care scope
 *
 * Every read and write below is keyed on `ownerId`. A thread is the
 * doctor's own working notes with an assistant — a colleague who shares
 * the patient has no business reading them, and the sharing model this
 * application has is about the *chart*, not about what a clinician
 * asked an assistant while thinking. A caller reaching for someone
 * else's thread gets 404, the same answer a thread that does not exist
 * produces, for the reason ADR-022 gives everywhere else.
 *
 * ## The context is resolved at creation and again at every send
 *
 * `AiContextService.resolve` runs before the row is written, so a
 * context that cannot be bound produces no conversation at all — M16.3's
 * "409, no generation" in its strongest form. `AiMessageService`
 * re-resolves before each generation, which is the same rule applied
 * over time: a care assignment revoked after the thread was opened has
 * to stop the next answer.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { Inject } from '@nestjs/common';
import type { AiContextMode } from '../../../generated/prisma/client';
import { AI_CONTEXT_MODE_FROM_WIRE } from '../dto/ai-enums';
import type { AiConversationDetailView, AiConversationView } from '../dto/ai.dto';
import type {
  CreateConversationInput,
  ListConversationsQuery,
  UpdateConversationInput,
} from '../dto/ai.schema';
import { AiConversationRepository } from '../repositories/ai-conversation.repository';
import { AiContextService } from './ai-context.service';
import { toConversationDetailView, toConversationView } from './ai-projection';

@Injectable()
export class AiConversationService {
  constructor(
    private readonly conversations: AiConversationRepository,
    private readonly context: AiContextService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** API §11.1 — `GET /ai/conversations`. */
  async list(
    user: AuthenticatedUser,
    query: ListConversationsQuery,
  ): Promise<readonly AiConversationView[]> {
    const rows = await this.conversations.list(user.id, {
      q: query.q,
      favorite: query.favorite,
    });

    return rows.map(toConversationView);
  }

  /** API §11.2 — `GET /ai/conversations/{id}`. */
  async detail(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<AiConversationDetailView> {
    const row = await this.conversations.detail(user.id, conversationId);
    if (row === null) throw notFound();

    return toConversationDetailView(row);
  }

  /** API §11.1 — `POST /ai/conversations`. */
  async create(
    user: AuthenticatedUser,
    input: CreateConversationInput,
  ): Promise<AiConversationDetailView> {
    // Before the row. A context that cannot be bound leaves no thread.
    const resolved = await this.context.resolve(user, input.context);

    const row = await this.conversations.create({
      ownerId: user.id,
      // A placeholder until the first question arrives, at which point
      // `AiMessageService` replaces it — see `titleFromMessage`.
      title: input.title ?? 'New conversation',
      contextMode: modeToEnum(input.context.mode),
      patientId: resolved.patient?.id ?? null,
      refPublicId: resolved.entity?.refId ?? null,
      // S4: a patient-bound thread is owned by the chart's hospital.
      hospitalId: resolved.scope?.hospitalId ?? null,
      hospitalMedicalRecordId: resolved.scope?.hospitalMedicalRecordId ?? null,
    });

    // Audited because binding a patient to an assistant thread is an
    // access to that patient's identity, and §14's log is where "who
    // asked an assistant about whom" has to be answerable. The metadata
    // carries handles only — never the question (MG §11.6).
    await this.audit.record({
      action: 'ai.conversation.create',
      actor: { userId: user.id, role: user.role },
      entityType: 'ai_conversation',
      entityId: row.id,
      metadata: {
        mode: input.context.mode,
        patientId: resolved.patient?.publicId ?? null,
        refId: resolved.entity?.refId ?? null,
      },
    });

    return toConversationDetailView(row);
  }

  /** API §11.1 — `PATCH …/{id}`. Title and favourite; never the context. */
  async update(
    user: AuthenticatedUser,
    conversationId: string,
    patch: UpdateConversationInput,
  ): Promise<AiConversationDetailView> {
    const row = await this.conversations.update(user.id, conversationId, patch);
    if (row === null) throw notFound();

    return toConversationDetailView(row);
  }

  /**
   * API §11.1 — `DELETE …/{id}`, soft.
   *
   * The row survives (DB §7: a patient-bound thread carries PHI, so it
   * is archived rather than destroyed), and the audit entry is what
   * makes the deletion itself reviewable.
   */
  async remove(user: AuthenticatedUser, conversationId: string): Promise<void> {
    const removed = await this.conversations.softDelete(user.id, conversationId);
    if (!removed) throw notFound();

    await this.audit.record({
      action: 'ai.conversation.delete',
      actor: { userId: user.id, role: user.role },
      entityType: 'ai_conversation',
      entityId: conversationId,
    });
  }
}

/**
 * Deliberately identical to the refusal a thread belonging to someone
 * else produces: the response must not distinguish "not yours" from
 * "does not exist".
 */
function notFound(): AppException {
  return AppException.notFound('Conversation not found');
}

export function modeToEnum(wire: string): AiContextMode {
  // Unreachable through the API: the Zod enum has already refused
  // anything outside the vocabulary. Falling back to `GENERAL` rather
  // than throwing keeps the failure closed — the least-bound mode.
  return AI_CONTEXT_MODE_FROM_WIRE[wire] ?? 'GENERAL';
}
