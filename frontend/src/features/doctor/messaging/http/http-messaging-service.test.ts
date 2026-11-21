import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, stubApi } from '@/test/api-stub';

import { httpMessagingService } from './http-messaging-service';

/**
 * Messaging in live mode (FE-10.8): not connected, except the unread count
 * the notifications API already serves.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpMessagingService', () => {
  it('answers every thread read as not connected — never the demo corpus', async () => {
    const { requests } = stubApi({});
    await expect(httpMessagingService.fetchConversations()).rejects.toMatchObject({
      code: 'not_connected',
    });
    await expect(httpMessagingService.fetchContacts()).rejects.toMatchObject({
      code: 'not_connected',
    });
    await expect(
      httpMessagingService.sendMessage({ conversationId: 'c-1', body: 'Hello', attempt: 1 }),
    ).rejects.toMatchObject({ code: 'not_connected' });
    expect(requests).toHaveLength(0);
  });

  it('serves the server’s unread count for the shell badge', async () => {
    stubApi({
      'GET /notifications/badge-counts': () => envelope({ notifications: 0, messages: 5 }),
    });
    await expect(httpMessagingService.fetchMessagingBadge()).resolves.toEqual({ unread: 5 });
  });
});
