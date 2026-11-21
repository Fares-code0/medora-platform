import { describe, expect, it } from 'vitest';

import { adapterImportOffenders } from '@/test/seam-rules';

import { messagingService } from './service';

/**
 * The messaging seam (DP-04). The feature's surface was complete — thread,
 * composer, folders, drafts, the shell badge — but three modules imported
 * `mock/mock-messaging-service` **directly**: the query layer, `ChatWorkspace`
 * (for `saveDraft`) and `MessagesPage` (for `openDirectConversation`). That is
 * the one thing `docs/handoff/auth-seam.md` §1 rule 3 forbids, and the exact
 * defect D-09 was filed about on the assistant.
 *
 * A type alone does not keep that closed, so the rule is asserted over the
 * source tree.
 */

describe('the messaging seam', () => {
  it('is the only route to the adapter — nothing downstream imports the mock', () => {
    expect(adapterImportOffenders(__dirname, 'mock/mock-messaging-service')).toStrictEqual([]);
  });

  it('exposes the whole port, so a real adapter has a complete contract to meet', () => {
    expect(Object.keys(messagingService).sort()).toStrictEqual([
      'deleteConversation',
      'deliverReply',
      'fetchContacts',
      'fetchConversations',
      'fetchMessagingBadge',
      'markConversationRead',
      'openDirectConversation',
      'saveDraft',
      'sendMessage',
      'updateConversation',
    ]);
  });

  it('saves a draft synchronously, because the composer autosaves on every keystroke', () => {
    // Not a style preference: a promise per debounced keystroke would put a
    // hundred in-flight writes behind one thread, and the last to *resolve*
    // rather than the last typed would win.
    expect(messagingService.saveDraft('cv-does-not-exist', 'scratch')).toBeUndefined();
  });
});
