/**
 * Conversation domain model — cross-feature, not feature-local
 * (FRONTEND_ARCHITECTURE §9.1 lists `Conversation` among the models
 * shared across features, alongside Patient/Doctor/Appointment/…).
 * Moved out of `features/doctor/messaging` when the admin's communication
 * monitoring became a second reader (UX §3.6). Shapes mirror the future
 * messaging DTOs so API integration swaps the mock service without
 * touching components. "me" is the signed-in doctor; contacts reuse the
 * canonical roster/doctor names.
 */

/**
 * Sentinel `authorId` for the signed-in doctor — not a contact, so it has
 * no `SEED_CONTACTS` entry. Baked into the persisted `medora.messaging.v1`
 * document (see `store.ts`/mock service), so any reader of that document,
 * doctor inbox or admin monitoring alike, needs this to recognise it.
 */
export const ME_ID = 'me';

export type ContactRole = 'doctor' | 'nurse' | 'pharmacist' | 'patient';

export type Presence = 'online' | 'away' | 'offline';

export interface Contact {
  readonly id: string;
  readonly name: string;
  readonly role: ContactRole;
  /**
   * The patient record this contact speaks for, when the contact is a
   * patient (D-24).
   *
   * The seed's ids already encode it by convention — `ct-pt-1002` is
   * PT-1002 — but reconstructing one from the other by string surgery
   * would make a naming convention load-bearing for navigation, and that
   * convention exists for a different reason entirely: contact ids reach
   * the PHI access log verbatim, so they are named by record id precisely
   * so they never carry a patient's name. Stating the link as a field
   * keeps those two concerns apart.
   */
  readonly patientId?: string;
  readonly department: string;
  readonly presence: Presence;
  /** ISO timestamp of last activity (drives "Active 2 h ago"). */
  readonly lastActiveAt: string;
  readonly favorite: boolean;
}

export type AttachmentKind = 'file' | 'image';

export interface MessageAttachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly sizeLabel: string;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessageKind = 'text' | 'system';

export interface ChatMessage {
  readonly id: string;
  /** Contact id, or `me` for the signed-in doctor. */
  readonly authorId: string;
  readonly kind: MessageKind;
  /** Markdown-lite: **bold**, `inline code`, ``` blocks, bare links. */
  readonly body: string;
  readonly sentAt: string;
  readonly status: MessageStatus;
  readonly attachments?: readonly MessageAttachment[];
}

export interface SharedLink {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

export interface Conversation {
  readonly id: string;
  /** Direct chats: one contact id; care-team threads: several. */
  readonly participantIds: readonly string[];
  /** Group threads carry a topic; direct chats derive it from the contact. */
  readonly topic: string | null;
  readonly messages: readonly ChatMessage[];
  readonly unreadCount: number;
  readonly pinned: boolean;
  readonly starred: boolean;
  readonly archived: boolean;
  readonly muted: boolean;
  readonly draft: string;
  readonly lastActivityAt: string;
}
