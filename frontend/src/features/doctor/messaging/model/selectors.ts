import {
  ME_ID,
  type Contact,
  type ContactRole,
  type Conversation,
  type Presence,
  type SharedLink,
} from '@/features/shared-domain/conversations';

/**
 * Pure derivations over the messaging workspace — folder filtering,
 * search, counts, titles, previews, and shared-asset extraction. All
 * inputs come from the query layer; nothing here touches storage.
 *
 * `MessagingFolder` and its presentation constants live here rather than
 * in the shared conversation model: a folder is a property of the
 * doctor's inbox (this feature's view over the shared conversations), not
 * of a conversation itself, and `PRESENCE_META`/`ROLE_LABELS` are display
 * strings/CSS classes for this feature's UI, not domain data the admin
 * side needs.
 */

export type MessagingFolder = 'inbox' | 'unread' | 'starred' | 'sent' | 'drafts' | 'archived';

export const FOLDER_LABELS: Record<MessagingFolder, string> = {
  inbox: 'Inbox',
  unread: 'Unread',
  starred: 'Starred',
  sent: 'Sent',
  drafts: 'Drafts',
  archived: 'Archived',
};

export const MESSAGING_FOLDERS = Object.keys(FOLDER_LABELS) as readonly MessagingFolder[];

export const PRESENCE_META: Record<
  Presence,
  { readonly label: string; readonly dotClass: string }
> = {
  online: { label: 'Online', dotClass: 'bg-success' },
  away: { label: 'Away', dotClass: 'bg-warning' },
  offline: { label: 'Offline', dotClass: 'bg-text-disabled' },
};

export const ROLE_LABELS: Record<ContactRole, string> = {
  doctor: 'Doctor',
  nurse: 'Nurse',
  pharmacist: 'Pharmacist',
  patient: 'Patient',
};

/**
 * Contacts by id, built from what the messaging port answered
 * (`fetchContacts`). It used to be built at module load from the demo seed,
 * which resolved names from fixtures whatever adapter was selected and kept
 * the seed in a production bundle (RM M40.4).
 */
export type ContactIndex = ReadonlyMap<string, Contact>;

export function indexContacts(contacts: readonly Contact[]): ContactIndex {
  return new Map(contacts.map((contact) => [contact.id, contact]));
}

export function contactById(id: string, contacts: ContactIndex): Contact | undefined {
  return contacts.get(id);
}

export function conversationContacts(
  conversation: Conversation,
  contacts: ContactIndex,
): readonly Contact[] {
  return conversation.participantIds
    .map((id) => contacts.get(id))
    .filter((contact): contact is Contact => contact !== undefined);
}

/** Direct chats: the contact's name; group threads: the stored topic. */
export function conversationTitle(conversation: Conversation, contacts: ContactIndex): string {
  if (conversation.topic !== null) return conversation.topic;
  return conversationContacts(conversation, contacts)[0]?.name ?? 'Conversation';
}

export function lastMessage(conversation: Conversation) {
  return conversation.messages[conversation.messages.length - 1];
}

export function conversationPreview(conversation: Conversation): string {
  if (conversation.draft !== '') return `Draft: ${conversation.draft}`;
  const last = lastMessage(conversation);
  if (last === undefined) return 'No messages yet';
  const prefix = last.authorId === ME_ID ? 'You: ' : '';
  const flattened = last.body
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\s+/g, ' ')
    .trim();
  return `${prefix}${flattened}`;
}

export function inFolder(conversation: Conversation, folder: MessagingFolder): boolean {
  switch (folder) {
    case 'inbox':
      return !conversation.archived;
    case 'unread':
      return !conversation.archived && conversation.unreadCount > 0;
    case 'starred':
      return !conversation.archived && conversation.starred;
    case 'sent':
      return !conversation.archived && lastMessage(conversation)?.authorId === ME_ID;
    case 'drafts':
      return !conversation.archived && conversation.draft !== '';
    case 'archived':
      return conversation.archived;
  }
}

function matchesQuery(conversation: Conversation, query: string, contacts: ContactIndex): boolean {
  const q = query.toLowerCase();
  if (conversationTitle(conversation, contacts).toLowerCase().includes(q)) return true;
  if (conversationContacts(conversation, contacts).some((c) => c.name.toLowerCase().includes(q))) {
    return true;
  }
  return conversation.messages.some((message) => message.body.toLowerCase().includes(q));
}

/** Count of message bodies matching the query (message search). */
export function messageMatchCount(conversation: Conversation, query: string): number {
  if (query === '') return 0;
  const q = query.toLowerCase();
  return conversation.messages.filter((message) => message.body.toLowerCase().includes(q)).length;
}

export function filterConversations(
  conversations: readonly Conversation[],
  folder: MessagingFolder,
  query: string,
  contacts: ContactIndex,
): readonly Conversation[] {
  const trimmed = query.trim();
  return conversations
    .filter((conversation) => inFolder(conversation, folder))
    .filter((conversation) => trimmed === '' || matchesQuery(conversation, trimmed, contacts))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
}

export function folderCounts(
  conversations: readonly Conversation[],
): Record<MessagingFolder, number> {
  return {
    inbox: conversations.filter((c) => inFolder(c, 'inbox')).length,
    unread: conversations.filter((c) => inFolder(c, 'unread')).length,
    starred: conversations.filter((c) => inFolder(c, 'starred')).length,
    sent: conversations.filter((c) => inFolder(c, 'sent')).length,
    drafts: conversations.filter((c) => inFolder(c, 'drafts')).length,
    archived: conversations.filter((c) => inFolder(c, 'archived')).length,
  };
}

export function totalUnread(conversations: readonly Conversation[]): number {
  return conversations
    .filter((c) => !c.archived && !c.muted)
    .reduce((sum, c) => sum + c.unreadCount, 0);
}

/* ── Shared assets (details panel) ──────────────────────────────── */

const LINK_PATTERN = /https?:\/\/[^\s)]+/g;

export function sharedAttachments(conversation: Conversation, kind: 'file' | 'image') {
  return conversation.messages.flatMap((message) =>
    (message.attachments ?? []).filter((attachment) => attachment.kind === kind),
  );
}

export function sharedLinks(conversation: Conversation): readonly SharedLink[] {
  return conversation.messages.flatMap((message) => {
    const urls = message.body.match(LINK_PATTERN) ?? [];
    return urls.map((url, index) => ({
      id: `${message.id}-link-${String(index)}`,
      label: url.replace(/^https?:\/\//, ''),
      url,
    }));
  });
}
