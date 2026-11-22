import { beforeEach, describe, expect, it } from 'vitest';

import { SEED_CONVERSATIONS } from './seed';
import {
  clearConversationsSession,
  removeLegacyConversationsStorage,
  setConversationsOwner,
} from './session-boundary';
import { localId, readStoredConversations, writeStoredConversations } from './store';

/**
 * Characterization tests for the messaging persistence boundary.
 *
 * Written before the module moves to `shared-domain`, against the code as it
 * stands, so that "nothing changed" is a claim with evidence behind it rather
 * than an assurance. They must pass unedited on the far side of the move; an
 * edit here would mean the behaviour moved with the file.
 */

const LEGACY_KEY = 'medora.messaging.v1';
const STORAGE_KEY = 'medora.messaging.v1.user-a';

beforeEach(() => {
  window.localStorage.clear();
  clearConversationsSession();
  setConversationsOwner('user-a');
});

describe('readStoredConversations', () => {
  it('seeds a cold store and writes the seed back', () => {
    const conversations = readStoredConversations();

    expect(conversations).toEqual(SEED_CONVERSATIONS);
    // The seed is persisted on first read, not merely returned — otherwise
    // every reload would re-seed over the user's own messages.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('returns what was written rather than the seed', () => {
    const [first] = SEED_CONVERSATIONS;
    // Throw rather than return: an early return would make this test pass
    // silently on an empty seed, which is the one case it must not survive.
    if (first === undefined) throw new Error('SEED_CONVERSATIONS is empty');
    const edited = [{ ...first, unreadCount: 99 }];

    writeStoredConversations(edited);

    expect(readStoredConversations()).toEqual(edited);
  });

  it('falls back to the seed on a malformed payload', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"not":"an array"}');

    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
  });

  it('falls back to the seed when an entry is not a conversation', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'x' }]));

    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
  });

  it('falls back to the seed on unparseable JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json at all');

    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
  });
});

describe('per-user isolation', () => {
  function edited(unreadCount: number) {
    const [first] = SEED_CONVERSATIONS;
    if (first === undefined) throw new Error('SEED_CONVERSATIONS is empty');
    return [{ ...first, unreadCount }];
  }

  it('keeps A and B apart in both directions', () => {
    writeStoredConversations(edited(11));

    setConversationsOwner('user-b');
    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
    writeStoredConversations(edited(22));

    setConversationsOwner('user-a');
    expect(readStoredConversations()).toEqual(edited(11));
    setConversationsOwner('user-b');
    expect(readStoredConversations()).toEqual(edited(22));
  });

  it('clearConversationsSession removes the owner data and resets the owner', () => {
    writeStoredConversations(edited(11));
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    clearConversationsSession();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Owner reset: a write now persists nothing.
    writeStoredConversations(edited(5));
    expect(window.localStorage.length).toBe(0);
  });

  it('never reads or writes the legacy global key, and removes it', () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(edited(77)));

    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
    writeStoredConversations(edited(3));
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(edited(77)));

    removeLegacyConversationsStorage();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();

    window.localStorage.setItem(LEGACY_KEY, 'x');
    clearConversationsSession();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('persists nothing when there is no owner', () => {
    setConversationsOwner(null);

    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
    writeStoredConversations(edited(9));

    expect(window.localStorage.length).toBe(0);
    // In-memory only, and dropped as soon as an owner is set.
    setConversationsOwner('user-a');
    expect(readStoredConversations()).toEqual(SEED_CONVERSATIONS);
  });
});

describe('localId', () => {
  it('carries the prefix and never repeats within a session', () => {
    const ids = [localId('msg'), localId('msg'), localId('msg')];

    for (const id of ids) expect(id.startsWith('msg-')).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });
});
