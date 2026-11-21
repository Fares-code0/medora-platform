import {
  ME_ID,
  SEED_CONTACTS,
  localId,
  readStoredConversations,
  writeStoredConversations,
  type ChatMessage,
  type Contact,
  type Conversation,
} from '@/features/shared-domain/conversations';

import type {
  ConversationPatch,
  MessagingService,
  SendMessageInput,
} from '../model/messaging-service';
import { totalUnread } from '../model/selectors';

/**
 * Mock messaging service — Promise-based seams shaped like the future
 * API client so TanStack Query swaps transports without touching hooks
 * or components. Latency is simulated; conversation state persists via
 * the feature store. A body containing `[fail]` rejects on the first
 * attempt so the failed/retry path stays demonstrable (same convention
 * as the notifications mock).
 */

const LATENCY_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchContacts(): Promise<readonly Contact[]> {
  await delay(LATENCY_MS);
  return SEED_CONTACTS;
}

async function fetchConversations(): Promise<readonly Conversation[]> {
  await delay(LATENCY_MS);
  return readStoredConversations();
}

async function fetchMessagingBadge(): Promise<{ readonly unread: number }> {
  await delay(120);
  return { unread: totalUnread(readStoredConversations()) };
}

function patchConversation(
  id: string,
  patch: (conversation: Conversation) => Conversation,
): readonly Conversation[] {
  const next = readStoredConversations().map((conversation) =>
    conversation.id === id ? patch(conversation) : conversation,
  );
  writeStoredConversations(next);
  return next;
}

async function updateConversation(id: string, patch: ConversationPatch): Promise<void> {
  await delay(160);
  patchConversation(id, (conversation) => ({ ...conversation, ...patch }));
}

/** Draft autosave skips the artificial latency (fires on a debounce). */
function saveDraft(id: string, draft: string): void {
  patchConversation(id, (conversation) => ({ ...conversation, draft }));
}

async function deleteConversation(id: string): Promise<void> {
  await delay(200);
  writeStoredConversations(readStoredConversations().filter((c) => c.id !== id));
}

async function sendMessage(input: SendMessageInput): Promise<void> {
  await delay(400);
  if (input.body.includes('[fail]') && input.attempt === 0) {
    appendMessage(input.conversationId, {
      id: localId('msg'),
      authorId: ME_ID,
      kind: 'text',
      body: input.body,
      sentAt: new Date().toISOString(),
      status: 'failed',
    });
    throw new Error('Message could not be delivered');
  }
  // Retry path: flip the failed copy instead of appending a duplicate.
  const retried = flipFailedMessage(input.conversationId, input.body);
  if (!retried) {
    appendMessage(input.conversationId, {
      id: localId('msg'),
      authorId: ME_ID,
      kind: 'text',
      body: input.body,
      sentAt: new Date().toISOString(),
      status: 'delivered',
    });
  }
}

function appendMessage(conversationId: string, message: ChatMessage): void {
  patchConversation(conversationId, (conversation) => ({
    ...conversation,
    messages: [...conversation.messages, message],
    draft: message.authorId === ME_ID ? '' : conversation.draft,
    unreadCount:
      message.authorId === ME_ID ? conversation.unreadCount : conversation.unreadCount + 1,
    lastActivityAt: message.sentAt,
  }));
}

function flipFailedMessage(conversationId: string, body: string): boolean {
  let flipped = false;
  patchConversation(conversationId, (conversation) => {
    const index = conversation.messages.findIndex(
      (message) => message.status === 'failed' && message.body === body,
    );
    if (index === -1) return conversation;
    flipped = true;
    const messages = conversation.messages.map((message, i) =>
      i === index
        ? { ...message, status: 'delivered' as const, sentAt: new Date().toISOString() }
        : message,
    );
    return { ...conversation, messages, lastActivityAt: new Date().toISOString() };
  });
  return flipped;
}

const CANNED_REPLIES: readonly string[] = [
  'Noted — thanks for the update.',
  'Got it. I will take a look and come back to you.',
  'Thanks, that helps. Let’s touch base at the next review.',
  'Understood. Anything else I should watch for?',
];

/**
 * Simulated counterpart reply: the first non-self participant answers
 * and my delivered messages flip to read. Triggered by the UI after a
 * successful send (paired with the typing indicator).
 */
async function deliverReply(conversationId: string): Promise<void> {
  await delay(120);
  patchConversation(conversationId, (conversation) => {
    const author = conversation.participantIds[0] ?? ME_ID;
    const replyIndex = conversation.messages.filter((m) => m.authorId === ME_ID).length;
    const body =
      CANNED_REPLIES[replyIndex % CANNED_REPLIES.length] ?? CANNED_REPLIES[0] ?? 'Noted.';
    const reply: ChatMessage = {
      id: localId('msg'),
      authorId: author,
      kind: 'text',
      body,
      sentAt: new Date().toISOString(),
      status: 'read',
    };
    const messages = conversation.messages.map((message) =>
      message.authorId === ME_ID && message.status !== 'failed'
        ? { ...message, status: 'read' as const }
        : message,
    );
    return {
      ...conversation,
      messages: [...messages, reply],
      lastActivityAt: reply.sentAt,
    };
  });
}

async function markConversationRead(id: string): Promise<void> {
  await delay(120);
  patchConversation(id, (conversation) => ({ ...conversation, unreadCount: 0 }));
}

/** Opens (or creates) the direct conversation with a contact. */
async function openDirectConversation(contactId: string): Promise<string> {
  await delay(200);
  const conversations = readStoredConversations();
  const existing = conversations.find(
    (conversation) =>
      conversation.participantIds.length === 1 && conversation.participantIds[0] === contactId,
  );
  if (existing !== undefined) return existing.id;

  const id = localId('cv');
  const created: Conversation = {
    id,
    participantIds: [contactId],
    topic: null,
    messages: [
      {
        id: localId('msg'),
        authorId: contactId,
        kind: 'system',
        body: 'Conversation started.',
        sentAt: new Date().toISOString(),
        status: 'read',
      },
    ],
    unreadCount: 0,
    pinned: false,
    starred: false,
    archived: false,
    muted: false,
    draft: '',
    lastActivityAt: new Date().toISOString(),
  };
  writeStoredConversations([created, ...conversations]);
  return id;
}

/**
 * The mock adapter. Reached only through `features/doctor/messaging/service.ts`
 * (`docs/handoff/auth-seam.md` §1, rule 3) — nothing downstream may import
 * this module, and `service.test.ts` asserts it over the source tree because
 * a type alone does not keep a seam closed.
 */
export const mockMessagingService: MessagingService = {
  fetchContacts,
  fetchConversations,
  fetchMessagingBadge,
  updateConversation,
  deleteConversation,
  sendMessage,
  markConversationRead,
  openDirectConversation,
  saveDraft,
  deliverReply,
};
