import { beforeEach, describe, expect, it } from 'vitest';

import { SEED_CONVERSATIONS } from './seed';
import { localId, readStoredConversations, writeStoredConversations } from './store';

/**
 * Characterization tests for the messaging persistence boundary.
 *
 * Written before the module moves to `shared-domain`, against the code as it
 * stands, so that "nothing changed" is a claim with evidence behind it rather
 * than an assurance. They must pass unedited on the far side of the move; an
 * edit here would mean the behaviour moved with the file.
 */

const STORAGE_KEY = 'medora.messaging.v1';

beforeEach(() => {
  window.localStorage.clear();
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

describe('localId', () => {
  it('carries the prefix and never repeats within a session', () => {
    const ids = [localId('msg'), localId('msg'), localId('msg')];

    for (const id of ids) expect(id.startsWith('msg-')).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });
});
