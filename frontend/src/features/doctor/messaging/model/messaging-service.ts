import type { ChatMessage, Contact, Conversation } from '@/features/shared-domain/conversations';

/**
 * The messaging port — `api/seam.ts`'s pattern, one feature, one port.
 *
 * **Where this file lives, and why it is not in `src/types/`.** The same
 * reasoning the laboratory and pharmacy ports record
 * (`labs/model/lab-service.ts`): `import/no-restricted-paths` forbids
 * `src/api` from importing a feature, so a port under `features/` cannot have
 * an HTTP adapter in `src/api/endpoints/` — and messaging cannot have one
 * anyway, because the backend implements auth, `/health`, `/ready` and
 * `/me/*` and no conversation endpoint exists
 * (`docs/handoff/auth-seam.md` §3). Fabricating an adapter for routes that do
 * not exist would be a lie that typechecks. The day they land, this file moves
 * to `src/types/messaging/`, the adapter is written, and `service.ts` grows a
 * `selectService` call; every consumer already imports `service.ts`, so
 * nothing downstream changes.
 */

/**
 * The mutable per-conversation flags. Every field is optional because the
 * surfaces that write them each own exactly one — the folder rail writes
 * `archived`, the row menu writes `pinned`/`starred`/`muted`, the thread
 * writes `unreadCount` — and a patch that had to carry the others would let
 * one control silently reset another's state.
 */
export interface ConversationPatch {
  readonly pinned?: boolean;
  readonly starred?: boolean;
  readonly archived?: boolean;
  readonly muted?: boolean;
  readonly unreadCount?: number;
  readonly draft?: string;
}

export interface SendMessageInput {
  readonly conversationId: string;
  readonly body: string;
  /**
   * Which try this is. The composer's retry re-sends the same body, and the
   * transport needs to tell a first attempt from a retry so a failed copy is
   * flipped rather than duplicated in the thread.
   */
  readonly attempt: number;
}

export interface MessagingService {
  /* ── Reads ─────────────────────────────────────────────────── */
  fetchContacts(): Promise<readonly Contact[]>;
  fetchConversations(): Promise<readonly Conversation[]>;
  /**
   * The shell's unread badge. Its own method rather than a count derived
   * from `fetchConversations` on the client, because the badge is polled
   * from every page in the workspace and pulling every thread's messages to
   * add up six integers is the wrong request to repeat on a timer.
   */
  fetchMessagingBadge(): Promise<{ readonly unread: number }>;

  /* ── Writes ────────────────────────────────────────────────── */
  updateConversation(id: string, patch: ConversationPatch): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<void>;
  markConversationRead(id: string): Promise<void>;
  /** Opens (or creates) the direct conversation with a contact. */
  openDirectConversation(contactId: string): Promise<string>;

  /**
   * Draft autosave. **Synchronous and fire-and-forget by contract**, because
   * it fires on every debounced keystroke in the composer: a promise here
   * would put a hundred in-flight writes behind one thread and the last one
   * to resolve — not the last one typed — would win. A real transport
   * implements this as a local write plus its own coalesced flush, which is
   * why the signature returns `void` rather than `Promise<void>`.
   */
  saveDraft(id: string, draft: string): void;

  /**
   * The simulated counterpart reply, and the one method here that a real
   * transport will not implement: a colleague answering is an inbound event
   * on a realtime channel, not something this client asks for. It stays on
   * the port so the mock adapter is reachable only through the seam like
   * every other method; a live adapter answers it by doing nothing and the
   * reply arrives over the channel instead.
   */
  deliverReply(conversationId: string): Promise<void>;
}

export type { ChatMessage, Contact, Conversation };
