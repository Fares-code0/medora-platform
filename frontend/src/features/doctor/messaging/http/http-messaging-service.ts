import { apiClient } from '@/api/client';
import { asRecord, notConnected, readData, readNumber } from '@/api/http';

import type { MessagingService } from '../model/messaging-service';

/**
 * Messaging in live mode (FE-10.8) — **not connected**, by scope: messaging
 * is outside FE-10, and the workspace's contacts, threads and sending have
 * no adapter yet. Every read and write answers `notConnected`, which the
 * screens render as "Not connected yet" — never the demo corpus, and never
 * an empty inbox that reads as "no conversations".
 *
 * The one live value is the unread count: `GET /notifications/badge-counts`
 * already serves it from the participant rows (API §11), so the shell's
 * badge is the server's number rather than the mock's.
 */

const notConnectedMessaging = () => Promise.reject(notConnected('Messaging'));

export const httpMessagingService: MessagingService = {
  fetchContacts: notConnectedMessaging,
  fetchConversations: notConnectedMessaging,

  async fetchMessagingBadge() {
    const data = asRecord(
      readData(await apiClient.get('/notifications/badge-counts'), 'badge counts'),
      'badge counts',
    );
    return { unread: readNumber(data, 'messages', 'badge counts') };
  },

  updateConversation: notConnectedMessaging,
  deleteConversation: notConnectedMessaging,
  sendMessage: notConnectedMessaging,
  markConversationRead: notConnectedMessaging,
  openDirectConversation: notConnectedMessaging,
  // Nowhere to keep a draft; the composer still holds what was typed.
  saveDraft: () => undefined,
  // A live transport never asks for a reply; one arrives over a channel.
  deliverReply: () => Promise.resolve(),
};
