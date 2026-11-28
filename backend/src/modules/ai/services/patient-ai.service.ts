/**
 * The patient assistant (ADR-050, contract §6): two experiences, one
 * service, no shared prompt with the clinician assistant.
 *
 * ## Who may call it
 *
 * A principal whose role is `patient`, and nobody else (403 `patient_only`).
 * Patients hold no `ai.use`, so they never reach `/ai/conversations`; and
 * clinicians never reach these routes. Threads are owner-only: someone
 * else's thread, a clinician's thread and an unknown id all answer 404.
 *
 * ## A send, in order
 *
 * 1. Ownership (404).
 * 2. **Red-flag pre-check** — deterministic, before anything else that could
 *    fail. On a match: the question and a fixed, localised escalation answer
 *    are persisted (`escalated: true`), and the gateway is **not** called.
 *    This runs even with no provider configured.
 * 3. Unconfigured gateway → 503 `service_unavailable`, nothing persisted —
 *    the model is never faked.
 * 4. Personal mode only: the patient-facing context is re-read from the
 *    session and audited (`patient_ai.context.read`).
 * 5. The question is persisted, then the answer streams (`delta` frames,
 *    then `done`), finishing as `complete` | `stopped` | `error` exactly as
 *    the clinician path does.
 *
 * The transcript log records shape only (M37.3): no text, no patient id.
 */

import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AI_GATEWAY, AiTranscriptLog, type AiGatewayPort } from '../../../shared/ai';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import type {
  PatientAiConversationCreated,
  PatientAiConversationDetailView,
  PatientAiConversationView,
  PatientAiMessageView,
} from '../dto/patient-ai.dto';
import type {
  CreatePatientConversationInput,
  SendPatientMessageInput,
} from '../dto/patient-ai.schema';
import {
  PatientAiConversationRepository,
  type PatientAiMode,
  type PatientMessageRow,
  type PatientThreadRow,
} from '../repositories/patient-ai-conversation.repository';
import { titleFromMessage } from './ai-prompt.builder';
import { AiSettingsService } from './ai-settings.service';
import { PatientAiContextService } from './patient-ai-context.service';
import {
  buildGeneralPatientPrompt,
  buildPersonalPatientPrompt,
  PATIENT_PLACEHOLDER_TITLE,
  type PatientAiLocale,
} from './patient-ai-prompt.builder';
import { detectRedFlag, ESCALATION_MESSAGE } from './patient-ai-red-flags';

const PATIENT_ROLE = 'patient';
const TURN_WINDOW = 20;
const TEMPERATURE = 0.3;
const MAX_OUTPUT_TOKENS = 1_000;

/** One SSE frame. `done.escalated` is true on the red-flag answer. */
export type PatientAiStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | {
      readonly type: 'done';
      readonly messageId: string;
      readonly status: string;
      readonly error: string | null;
      readonly escalated: boolean;
    };

@Injectable()
export class PatientAiService {
  constructor(
    private readonly conversations: PatientAiConversationRepository,
    private readonly context: PatientAiContextService,
    private readonly settings: AiSettingsService,
    private readonly transcript: AiTranscriptLog,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(AI_GATEWAY) private readonly gateway: AiGatewayPort,
  ) {}

  async list(user: AuthenticatedUser): Promise<readonly PatientAiConversationView[]> {
    requirePatient(user);
    const rows = await this.conversations.list(user.id);

    return rows.map(toView);
  }

  async detail(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<PatientAiConversationDetailView> {
    requirePatient(user);
    const row = await this.conversations.detail(user.id, conversationId);
    if (row === null) throw notFound();

    return { ...toView(row), messages: row.messages.map(toMessageView) };
  }

  async create(
    user: AuthenticatedUser,
    input: CreatePatientConversationInput,
  ): Promise<PatientAiConversationCreated> {
    requirePatient(user);

    // Personal mode needs a linked record to have anything to say; refusing
    // now lets the app show its linking screen instead of an empty thread.
    if (input.mode === 'personal') await this.context.requireLinkedPatient(user);

    const row = await this.conversations.create({
      ownerId: user.id,
      mode: input.mode,
      title: PATIENT_PLACEHOLDER_TITLE,
    });

    await this.audit.record({
      action: 'patient_ai.conversation.create',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'ai_conversation',
      entityId: row.id,
      metadata: { mode: input.mode },
    });

    return {
      id: row.id,
      mode: modeOf(row),
      createdAt: row.createdAt.toISOString(),
      title: row.title,
    };
  }

  async remove(user: AuthenticatedUser, conversationId: string): Promise<void> {
    requirePatient(user);
    const removed = await this.conversations.softDelete(user.id, conversationId);
    if (!removed) throw notFound();

    await this.audit.record({
      action: 'patient_ai.conversation.delete',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'ai_conversation',
      entityId: conversationId,
    });
  }

  /** Streams one exchange; see the file header for the order of the checks. */
  async *send(
    user: AuthenticatedUser,
    conversationId: string,
    input: SendPatientMessageInput,
    signal: AbortSignal,
  ): AsyncGenerator<PatientAiStreamEvent> {
    requirePatient(user);
    const header = await this.conversations.header(user.id, conversationId);
    if (header === null) throw notFound();

    const mode = modeOf(header);
    const locale = input.locale ?? (await this.preferredLocale(user.id));
    const startedAt = Date.now();

    // 2. The red-flag pre-check, before the gateway and before the
    //    configuration check: an emergency is answered on every deployment.
    if (detectRedFlag(input.content) !== null) {
      await this.conversations.appendMessage({
        conversationId,
        role: 'USER',
        content: input.content,
        status: 'COMPLETE',
      });
      await this.nameThread(user.id, header, input.content);

      const text = ESCALATION_MESSAGE[locale];
      const answer = await this.conversations.appendMessage({
        conversationId,
        role: 'ASSISTANT',
        content: text,
        status: 'COMPLETE',
        escalated: true,
      });

      // Shape only. The matched category is deliberately not logged or
      // audited: "this patient mentioned suicide" is itself health data.
      this.transcript.record({
        conversationId,
        userId: user.id,
        patientBound: mode === 'personal',
        contextMode: `patient_${mode}`,
        promptChars: input.content.length,
        completionChars: text.length,
        durationMs: Date.now() - startedAt,
        outcome: 'escalated',
      });

      yield { type: 'delta', text };
      yield { type: 'done', messageId: answer.id, status: 'complete', error: null, escalated: true };
      return;
    }

    // 3. No provider → an honest 503 before anything is written.
    if (!this.gateway.describe().configured) throw unconfigured();

    // 4. Personal context: re-read from the session, every turn.
    const system =
      mode === 'personal'
        ? buildPersonalPatientPrompt(await this.context.load(user, conversationId), locale)
        : buildGeneralPatientPrompt(locale);

    // 5. Persist the question, then stream.
    await this.conversations.appendMessage({
      conversationId,
      role: 'USER',
      content: input.content,
      status: 'COMPLETE',
    });
    await this.nameThread(user.id, header, input.content);

    const turns = await this.conversations.turnsFor(conversationId, TURN_WINDOW);
    const answer = await this.conversations.appendMessage({
      conversationId,
      role: 'ASSISTANT',
      content: '',
      status: 'COMPLETE',
    });

    let text = '';
    let status: 'COMPLETE' | 'STOPPED' | 'ERROR' = 'COMPLETE';
    let error: string | null = null;

    try {
      const stream = this.gateway.generate(
        {
          system,
          // Patient text travels only as turns — never inside `system`.
          turns: turns.map((row) => ({
            role: row.role === 'ASSISTANT' ? 'assistant' : 'user',
            content: row.content,
          })),
          temperature: TEMPERATURE,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          language: locale,
        },
        signal,
      );

      for await (const delta of stream) {
        text += delta.text;
        yield { type: 'delta', text: delta.text };
      }
    } catch (cause) {
      if (signal.aborted) {
        status = 'STOPPED';
      } else {
        status = 'ERROR';
        error = cause instanceof AppException ? cause.message : 'The assistant could not answer. Try again.';
      }
    } finally {
      // See `AiMessageService.send`: a generator returned at a suspended
      // `yield` resumes only its `finally`.
      if (signal.aborted && status === 'COMPLETE') status = 'STOPPED';

      const finished = await this.conversations.finishMessage({
        messageId: answer.id,
        content: text,
        status,
        error,
      });

      this.transcript.record({
        conversationId,
        userId: user.id,
        patientBound: mode === 'personal',
        contextMode: `patient_${mode}`,
        promptChars: input.content.length,
        completionChars: text.length,
        durationMs: Date.now() - startedAt,
        outcome: finished.status.toLowerCase(),
        ...(error === null ? {} : { errorCode: 'generation_failed' }),
      });
    }

    yield {
      type: 'done',
      messageId: answer.id,
      status: status.toLowerCase(),
      error,
      escalated: false,
    };
  }

  private async preferredLocale(userId: string): Promise<PatientAiLocale> {
    const { language } = await this.settings.effective(userId);

    return language === 'ar' ? 'ar' : 'en';
  }

  private async nameThread(ownerId: string, header: PatientThreadRow, content: string): Promise<void> {
    if (header.title !== PATIENT_PLACEHOLDER_TITLE) return;
    await this.conversations.rename(ownerId, header.id, titleFromMessage(content, header.title));
  }
}

/** 403 `patient_only` for anyone whose role is not `patient` (contract §6). */
export function requirePatient(user: AuthenticatedUser): void {
  if (user.role !== PATIENT_ROLE) {
    throw AppException.forbidden('This assistant is for patients only', 'patient_only');
  }
}

function modeOf(row: { readonly patientMode: string | null }): PatientAiMode {
  return row.patientMode === 'personal' ? 'personal' : 'general';
}

function toView(row: PatientThreadRow): PatientAiConversationView {
  return {
    id: row.id,
    mode: modeOf(row),
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount: row._count.messages,
  };
}

function toMessageView(row: PatientMessageRow): PatientAiMessageView {
  return {
    id: row.id,
    role: row.role === 'ASSISTANT' ? 'assistant' : 'user',
    content: row.content,
    status: row.status.toLowerCase(),
    error: row.error,
    escalated: row.escalated,
    createdAt: row.createdAt.toISOString(),
  };
}

function notFound(): AppException {
  return AppException.notFound('Conversation not found');
}

/** The same envelope `UnconfiguredAiGateway` raises, so both paths read alike. */
function unconfigured(): AppException {
  return new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
    message: 'The AI assistant is not configured',
    code: 'service_unavailable',
    detail: 'No AI provider is configured for this deployment',
  });
}
