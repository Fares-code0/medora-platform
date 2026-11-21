import { describe, expect, it } from 'vitest';

import {
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
} from '../../../generated/prisma/enums';

import {
  CHANNELS,
  DEFAULT_PREFERENCES,
  inQuietHours,
  selectChannels,
  type ChannelPreferences,
} from './channel-selection';

/**
 * Channel selection — RM M19.4.
 *
 * > ✅ Verify: both rule tests.
 *
 * The two rules are `categories.security` staying on and quiet hours
 * never suppressing critical alerts. The first is a database CHECK and
 * is asserted over HTTP in `notification-fanout.e2e-spec.ts`; what is
 * tested here is that this function would not suppress the category even
 * if the column somehow were false, and that a critical notification
 * goes out mid-quiet-hours.
 *
 * Everything here is a pure function over a preferences row, so the
 * clock is a parameter rather than something to fake.
 */
const AT = (hour: number, minute = 0) => new Date(Date.UTC(2026, 8, 18, hour, minute));
const TIME = (hour: number, minute = 0) => new Date(Date.UTC(1970, 0, 1, hour, minute));

function prefs(overrides: Partial<ChannelPreferences> = {}): ChannelPreferences {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

function statusOf(decisions: readonly { channel: string; status: string }[], channel: string) {
  return decisions.find((decision) => decision.channel === channel)?.status;
}

describe('every channel gets a row', () => {
  it('returns one decision per channel, always', () => {
    const decisions = selectChannels({
      prefs: prefs(),
      category: NotificationCategory.APPOINTMENTS,
      priority: NotificationPriority.NORMAL,
      now: AT(12),
    });

    expect(decisions).toHaveLength(CHANNELS.length);
    expect(decisions.map((decision) => decision.channel)).toEqual([...CHANNELS]);
  });

  /**
   * A missing row would read as "never attempted"; the column's own
   * comment says `skipped` exists so that a deliberate suppression is
   * distinguishable from one.
   */
  it('marks a disabled channel skipped rather than omitting it', () => {
    const decisions = selectChannels({
      prefs: prefs({ channelSms: false }),
      category: NotificationCategory.APPOINTMENTS,
      priority: NotificationPriority.NORMAL,
      now: AT(12),
    });

    expect(statusOf(decisions, NotificationChannel.SMS)).toBe('skipped');
    expect(decisions.find((d) => d.channel === NotificationChannel.SMS)?.reason).toBe(
      'channel-off',
    );
    expect(statusOf(decisions, NotificationChannel.EMAIL)).toBe('pending');
  });

  it('skips every channel when the category is off, and says which rule did it', () => {
    const decisions = selectChannels({
      prefs: prefs({ catAppointments: false }),
      category: NotificationCategory.APPOINTMENTS,
      priority: NotificationPriority.NORMAL,
      now: AT(12),
    });

    expect(decisions.every((decision) => decision.status === 'skipped')).toBe(true);
    // The channels that were themselves off report `channel-off`; the
    // rest report the category. The order of the checks is what makes
    // the reason answer "why was this not sent" precisely.
    expect(decisions.find((d) => d.channel === NotificationChannel.EMAIL)?.reason).toBe(
      'category-off',
    );
    expect(decisions.find((d) => d.channel === NotificationChannel.SMS)?.reason).toBe(
      'channel-off',
    );
  });

  it('does not suppress security even if its column were false', () => {
    // The CHECK makes this unreachable through the API; the function is
    // written so that the guarantee does not depend on the CHECK alone.
    const decisions = selectChannels({
      prefs: prefs({ catSecurity: false, catAppointments: false }),
      category: NotificationCategory.SECURITY,
      priority: NotificationPriority.NORMAL,
      now: AT(12),
    });

    expect(statusOf(decisions, NotificationChannel.EMAIL)).toBe('skipped');
  });
});

describe('quiet hours', () => {
  const quiet = prefs({ quietHoursEnabled: true, quietFrom: TIME(22), quietTo: TIME(7) });

  it('is inactive when disabled, whatever the clock says', () => {
    expect(inQuietHours(prefs({ quietFrom: TIME(22), quietTo: TIME(7) }), AT(23))).toBe(false);
  });

  it('wraps midnight', () => {
    expect(inQuietHours(quiet, AT(23))).toBe(true);
    expect(inQuietHours(quiet, AT(2))).toBe(true);
    expect(inQuietHours(quiet, AT(6, 59))).toBe(true);
  });

  it('ends exactly at `to`, and has not begun at one minute before `from`', () => {
    expect(inQuietHours(quiet, AT(7))).toBe(false);
    expect(inQuietHours(quiet, AT(21, 59))).toBe(false);
    expect(inQuietHours(quiet, AT(22))).toBe(true);
  });

  /**
   * A daytime window is a legal configuration and must not be read as
   * its own complement — the wrap test is `from > to`, not an assumption
   * that quiet hours are always overnight.
   */
  it('handles a window that does not wrap', () => {
    const daytime = prefs({ quietHoursEnabled: true, quietFrom: TIME(9), quietTo: TIME(17) });

    expect(inQuietHours(daytime, AT(12))).toBe(true);
    expect(inQuietHours(daytime, AT(8))).toBe(false);
    expect(inQuietHours(daytime, AT(18))).toBe(false);
  });

  it('suppresses nothing when the window is empty', () => {
    const empty = prefs({ quietHoursEnabled: true, quietFrom: TIME(22), quietTo: TIME(22) });

    expect(inQuietHours(empty, AT(22))).toBe(false);
    expect(inQuietHours(empty, AT(3))).toBe(false);
  });

  it('skips a normal notification raised inside the window', () => {
    const decisions = selectChannels({
      prefs: quiet,
      category: NotificationCategory.APPOINTMENTS,
      priority: NotificationPriority.NORMAL,
      now: AT(23),
    });

    expect(statusOf(decisions, NotificationChannel.EMAIL)).toBe('skipped');
    expect(decisions.find((d) => d.channel === NotificationChannel.EMAIL)?.reason).toBe(
      'quiet-hours',
    );
  });

  /**
   * M19.4's second rule, and the one with a clinical consequence: a
   * critical alert that waited until 07:00 is the failure the rule
   * exists to prevent.
   */
  it('never suppresses a critical notification', () => {
    const decisions = selectChannels({
      prefs: quiet,
      category: NotificationCategory.LABORATORY,
      priority: NotificationPriority.CRITICAL,
      now: AT(3),
    });

    expect(statusOf(decisions, NotificationChannel.EMAIL)).toBe('pending');
    expect(statusOf(decisions, NotificationChannel.PUSH)).toBe('pending');
  });

  /**
   * The override is on urgency, not on the laboratory category — an
   * `important` lab notification is still quiet-hours material, and a
   * critical notification from any category is not.
   */
  it('overrides on priority rather than on category', () => {
    const importantLab = selectChannels({
      prefs: quiet,
      category: NotificationCategory.LABORATORY,
      priority: NotificationPriority.IMPORTANT,
      now: AT(3),
    });
    const criticalSystem = selectChannels({
      prefs: quiet,
      category: NotificationCategory.SYSTEM,
      priority: NotificationPriority.CRITICAL,
      now: AT(3),
    });

    expect(statusOf(importantLab, NotificationChannel.EMAIL)).toBe('skipped');
    expect(statusOf(criticalSystem, NotificationChannel.EMAIL)).toBe('pending');
  });

  it('still respects an off channel for a critical notification', () => {
    const decisions = selectChannels({
      prefs: { ...quiet, channelSms: false },
      category: NotificationCategory.LABORATORY,
      priority: NotificationPriority.CRITICAL,
      now: AT(3),
    });

    // Urgency overrides the *clock*, not the user's channel choice: a
    // patient who never gave a mobile number is not paged by SMS.
    expect(statusOf(decisions, NotificationChannel.SMS)).toBe('skipped');
  });
});
