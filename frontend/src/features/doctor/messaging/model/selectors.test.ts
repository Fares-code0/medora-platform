import { describe, expect, it } from 'vitest';

import type { Contact, Conversation } from '@/features/shared-domain/conversations';

import {
  contactById,
  conversationContacts,
  conversationTitle,
  filterConversations,
  indexContacts,
} from './selectors';

/**
 * Contact resolution reads the contacts the messaging port answered with
 * (RM M40.4). It used to read the demo seed whatever adapter was selected,
 * so a name came from fixtures even when the server had sent none.
 */

const contact: Contact = {
  id: 'c-1',
  name: 'Dr. Ines Ferreira',
  role: 'doctor',
  specialty: null,
  presence: 'online',
  patientId: null,
} as unknown as Contact;

const conversation = {
  id: 'cv-1',
  participantIds: ['c-1'],
  topic: null,
  messages: [],
  draft: '',
  archived: false,
  starred: false,
  pinned: false,
  muted: false,
  unreadCount: 0,
  lastActivityAt: '2026-11-13T09:00:00.000Z',
} as unknown as Conversation;

describe('contact resolution', () => {
  it('resolves names from the index it is given', () => {
    const index = indexContacts([contact]);
    expect(contactById('c-1', index)).toBe(contact);
    expect(conversationContacts(conversation, index)).toEqual([contact]);
    expect(conversationTitle(conversation, index)).toBe('Dr. Ines Ferreira');
  });

  it('resolves nothing from an empty index — no fixture fills the gap', () => {
    const empty = indexContacts([]);
    expect(contactById('c-1', empty)).toBeUndefined();
    expect(conversationContacts(conversation, empty)).toEqual([]);
    expect(conversationTitle(conversation, empty)).toBe('Conversation');
  });

  it('searches participant names through the same index', () => {
    const index = indexContacts([contact]);
    expect(filterConversations([conversation], 'inbox', 'ferreira', index)).toEqual([conversation]);
    expect(filterConversations([conversation], 'inbox', 'ferreira', indexContacts([]))).toEqual([]);
  });
});
