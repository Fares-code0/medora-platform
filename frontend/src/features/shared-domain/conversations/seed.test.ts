import { describe, expect, it } from 'vitest';

import { SEED_CONTACTS, SEED_CONVERSATIONS } from './seed';

/**
 * Invariants the seed has always held, pinned before it moves.
 *
 * These outlive this refactor: ADM-06's admin table renders participants by
 * id, so a conversation naming a contact that does not exist would render a
 * blank participant rather than fail loudly.
 */

describe('the conversation seed', () => {
  it('is not empty', () => {
    expect(SEED_CONVERSATIONS.length).toBeGreaterThan(0);
    expect(SEED_CONTACTS.length).toBeGreaterThan(0);
  });

  it('resolves every participant to a known contact', () => {
    const contactIds = new Set(SEED_CONTACTS.map((contact) => contact.id));

    for (const conversation of SEED_CONVERSATIONS) {
      expect(conversation.participantIds.length).toBeGreaterThan(0);
      for (const participantId of conversation.participantIds) {
        expect(contactIds.has(participantId)).toBe(true);
      }
    }
  });

  it('gives every conversation at least one message', () => {
    for (const conversation of SEED_CONVERSATIONS) {
      expect(conversation.messages.length).toBeGreaterThan(0);
    }
  });

  it('uses unique conversation ids', () => {
    const ids = SEED_CONVERSATIONS.map((conversation) => conversation.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
