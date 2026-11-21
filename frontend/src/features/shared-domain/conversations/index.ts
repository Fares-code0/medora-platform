/**
 * Conversations — the shared messaging domain.
 *
 * Lives here rather than in `features/doctor/messaging` because two features
 * read it: the doctor's inbox and the admin's communication monitoring
 * (UX §3.6). `FRONTEND_ARCHITECTURE.md` §9.1 lists `Conversation` among the
 * cross-feature models, and §3.3 makes `shared-domain/` the only place a
 * feature may import from another.
 *
 * The persisted store moves with the model deliberately: if the admin read
 * the seed while the doctor read their own mutations, a message sent in the
 * inbox would be missing from the admin's table.
 */
export { findContactForPatient } from './contacts';
export { SEED_CONTACTS, SEED_CONVERSATIONS } from './seed';
export { localId, readStoredConversations, writeStoredConversations } from './store';
export { ME_ID } from './types';
export type {
  AttachmentKind,
  ChatMessage,
  Contact,
  ContactRole,
  Conversation,
  MessageAttachment,
  MessageKind,
  MessageStatus,
  Presence,
  SharedLink,
} from './types';
