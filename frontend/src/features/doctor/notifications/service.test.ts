import { describe, expect, it } from 'vitest';

import { adapterImportOffenders } from '@/test/seam-rules';

import { notificationService } from './service';

/**
 * The notifications seam (DP-04). The feature was complete — list, filters,
 * optimistic read/archive/pin, the live delivery simulation, the shell badges
 * — but five modules imported `mock/mock-notification-service` **directly**:
 * the query layer for the adapter itself, and four surfaces reaching in for
 * the `NotificationPatch` type. Both are the defect
 * `docs/handoff/auth-seam.md` §1 rule 3 names; the type one is the quieter
 * half, because a patch shape defined in the mock is a patch shape that gets
 * rewritten on integration day.
 *
 * A type alone does not keep that closed, so the rule is asserted over the
 * source tree.
 */

describe('the notifications seam', () => {
  it('is the only route to the adapter — nothing downstream imports the mock', () => {
    expect(adapterImportOffenders(__dirname, 'mock/mock-notification-service')).toStrictEqual([]);
  });

  it('exposes the whole port, so a real adapter has a complete contract to meet', () => {
    expect(Object.keys(notificationService).sort()).toStrictEqual([
      'archiveAllRead',
      'capabilities',
      'deleteNotifications',
      'fetchBadgeCounts',
      'fetchConversations',
      'fetchNotifications',
      'fetchPreferences',
      'markAllRead',
      'markConversationRead',
      'savePreferences',
      'sendMessage',
      'updateNotifications',
    ]);
  });

  it('answers archiveAllRead with the number it moved, not void', async () => {
    // The toast reports a count. Deriving it on the client would be a guess
    // about what the write did rather than a report of it.
    await expect(notificationService.archiveAllRead()).resolves.toEqual(expect.any(Number));
  });

  it('marks every unread, unarchived notification read, and nothing in the archive', async () => {
    const before = await notificationService.fetchNotifications();
    const expected = before.filter((n) => !n.read && !n.archived).length;
    const archivedUnread = before.filter((n) => !n.read && n.archived).map((n) => n.id);

    await expect(notificationService.markAllRead()).resolves.toBe(expected);

    const after = await notificationService.fetchNotifications();
    expect(after.filter((n) => !n.archived).every((n) => n.read)).toBe(true);
    expect(after.filter((n) => !n.read).map((n) => n.id)).toEqual(archivedUnread);
    await expect(notificationService.fetchBadgeCounts()).resolves.toMatchObject({
      notifications: 0,
    });
  });
});
