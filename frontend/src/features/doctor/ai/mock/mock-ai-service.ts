import { hashString } from '@/features/shared-domain/patient-identity';

import {
  AI_GENERATION_FAILED,
  type AiService,
  type ConversationPatch,
  type CreateConversationInput,
  type GenerateReplyInput,
} from '../model/ai-service';
import { buildAssistantResponse, buildContextGreeting } from '../model/responses';
import { localId, readConversations, writeConversations } from '../model/store';
import { type AiConversation, type ChatMessage } from '../model/types';

/**
 * Mock AI service — the one adapter behind `model/ai-service.ts`, and the
 * only implementation until a model service exists (§9 row 4).
 *
 * Async with realistic latency; conversation CRUD goes to the in-memory store (S1)
 * and `generateReply` produces deterministic canned responses with simulated
 * failures (retry succeeds).
 *
 * **Nothing outside `../service` may import this file** — that is seam rule
 * 3, and until D-09 both `api/useAiQueries.ts` and `hooks/useChatSession.ts`
 * broke it by importing the adapter directly, which is precisely the defect
 * `docs/handoff/auth-seam.md` was written about.
 *
 * The canned prose is realistic clinical Markdown, which is only safe
 * because every reply carries the disclaimer `model/responses.ts` appends —
 * naming itself as mock output from seeded demo data — and `ChatPanel`
 * repeats it under the composer. Keep both when editing this file.
 */

const LATENCY_CRUD_MS = 250;
const LATENCY_THINKING_MS = 900;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── Conversation CRUD ──────────────────────────────────────────── */

async function listConversations(): Promise<readonly AiConversation[]> {
  await delay(LATENCY_CRUD_MS);
  return [...readConversations()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Synchronous create — conversation creation gates navigation (?c=<id>),
 * so the UI must not depend on async mutation callbacks that React can
 * legitimately drop across remounts. The in-memory store is sync
 * anyway; with a real API this becomes a router action/optimistic id.
 */
function createConversation(input: CreateConversationInput): AiConversation {
  const now = new Date().toISOString();
  const messages: ChatMessage[] = input.seedGreeting
    ? [
        {
          id: localId('msg'),
          role: 'assistant',
          content: buildContextGreeting(input.context),
          createdAt: now,
          status: 'complete',
          error: null,
        },
      ]
    : [];
  const conversation: AiConversation = {
    id: localId('conv'),
    title: input.title ?? 'New conversation',
    context: input.context,
    messages,
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
  writeConversations([conversation, ...readConversations()]);
  return conversation;
}

async function updateConversation(
  conversationId: string,
  patch: ConversationPatch,
): Promise<AiConversation> {
  await delay(LATENCY_CRUD_MS);
  const conversations = readConversations();
  const existing = conversations.find((c) => c.id === conversationId);
  if (!existing) throw new Error('CONVERSATION_NOT_FOUND');
  const updated: AiConversation = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeConversations(conversations.map((c) => (c.id === conversationId ? updated : c)));
  return updated;
}

async function deleteConversation(conversationId: string): Promise<void> {
  await delay(LATENCY_CRUD_MS);
  writeConversations(readConversations().filter((c) => c.id !== conversationId));
}

/* ── Generation ─────────────────────────────────────────────────── */

/**
 * Deterministic failure simulation: prompts containing "[fail]" and a
 * stable ~10% hash bucket fail on the FIRST attempt only, so "Retry"
 * demonstrably succeeds.
 */
function shouldFail(input: GenerateReplyInput): boolean {
  if (input.attempt > 1) return false;
  if (input.prompt.toLowerCase().includes('[fail]')) return true;
  return hashString(input.prompt) % 100 < 10;
}

async function generateReply(input: GenerateReplyInput): Promise<string> {
  // Thinking latency scales a little with requested verbosity.
  const verbosityMs = input.settings.responseLength === 'detailed' ? 500 : 0;
  await delay(LATENCY_THINKING_MS + verbosityMs);

  if (shouldFail(input)) {
    throw new Error(AI_GENERATION_FAILED);
  }

  return buildAssistantResponse({
    prompt: input.prompt,
    promptId: input.promptId,
    context: input.context,
    responseLength: input.settings.responseLength,
  });
}

export const mockAiService: AiService = {
  listConversations,
  createConversation,
  updateConversation,
  deleteConversation,
  generateReply,
};
