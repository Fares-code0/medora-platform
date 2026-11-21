/**
 * Which channels a notification is actually sent on (RM M19.4, M19.5).
 *
 * ## `skipped` is an outcome, not an absence
 *
 * `notification_deliveries.status` carries `skipped` deliberately — the
 * column's own comment says why: "quiet hours and a per-category opt-out
 * both suppress a channel deliberately, and a missing row would read as
 * 'never attempted'". So every channel gets a row on every notification,
 * and the row records whether it was suppressed and by what.
 *
 * ## The two rules that are not preferences
 *
 * **Security can never be switched off.** DB §G7 puts a CHECK on
 * `cat_security` forcing it true, and the reason it is a database rule
 * rather than a UI one is that a UI-only guarantee is one API client
 * away from a user who never learns their password was changed. This
 * function does not need to enforce it — the column cannot be false —
 * but it must not be written in a way that would suppress the category
 * if it somehow were.
 *
 * **Quiet hours never suppress critical lab alerts.** RM M19.4 states it
 * as a verify step. It is expressed here against `priority = critical`
 * rather than against the laboratory category, because the property that
 * matters is urgency: a critical alert that waited until 07:00 is the
 * failure the rule exists to prevent, whatever raised it.
 */

import {
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
} from '../../../generated/prisma/enums';

/** The five channels, in a fixed order so delivery rows are comparable. */
export const CHANNELS = [
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
  NotificationChannel.PUSH,
  NotificationChannel.DESKTOP,
  NotificationChannel.IN_APP,
] as const;

export interface ChannelPreferences {
  readonly channelEmail: boolean;
  readonly channelSms: boolean;
  readonly channelPush: boolean;
  readonly channelDesktop: boolean;
  readonly channelInApp: boolean;

  readonly quietHoursEnabled: boolean;
  readonly quietFrom: Date;
  readonly quietTo: Date;

  readonly catAppointments: boolean;
  readonly catMedicalRecords: boolean;
  readonly catLaboratory: boolean;
  readonly catPharmacy: boolean;
  readonly catPatients: boolean;
  readonly catAi: boolean;
  readonly catSystem: boolean;
  readonly catSecurity: boolean;
}

export type SkipReason = 'channel-off' | 'category-off' | 'quiet-hours';

export interface ChannelDecision {
  readonly channel: NotificationChannel;
  readonly status: 'pending' | 'skipped';
  readonly reason: SkipReason | null;
}

function channelEnabled(prefs: ChannelPreferences, channel: NotificationChannel): boolean {
  switch (channel) {
    case NotificationChannel.EMAIL:
      return prefs.channelEmail;
    case NotificationChannel.SMS:
      return prefs.channelSms;
    case NotificationChannel.PUSH:
      return prefs.channelPush;
    case NotificationChannel.DESKTOP:
      return prefs.channelDesktop;
    case NotificationChannel.IN_APP:
      return prefs.channelInApp;
  }
}

/**
 * `Record<…>` rather than a switch with a default, so adding a category
 * to the enum without adding its preference column stops the build.
 */
function categoryEnabled(prefs: ChannelPreferences, category: NotificationCategory): boolean {
  const byCategory: Record<NotificationCategory, boolean> = {
    APPOINTMENTS: prefs.catAppointments,
    MEDICAL_RECORDS: prefs.catMedicalRecords,
    LABORATORY: prefs.catLaboratory,
    PHARMACY: prefs.catPharmacy,
    PATIENTS: prefs.catPatients,
    AI: prefs.catAi,
    SYSTEM: prefs.catSystem,
    SECURITY: prefs.catSecurity,
  };

  return byCategory[category];
}

/**
 * Minutes since midnight, from a `time` column.
 *
 * Prisma hands a `@db.Time` back as a `Date` on 1970-01-01 in UTC, so
 * the wall-clock fields are the UTC ones. Reading local getters here
 * would shift every clinic's quiet hours by the server's offset.
 */
function minutesOfDay(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

/**
 * Quiet hours usually wrap midnight — the column defaults are 22:00 to
 * 07:00 — so the window is a wrap when `from > to`, and the test flips
 * from "between" to "outside" accordingly. A non-wrapping window
 * (09:00–17:00) is still a legal configuration and must not be read as
 * its own complement.
 */
export function inQuietHours(prefs: ChannelPreferences, now: Date): boolean {
  if (!prefs.quietHoursEnabled) return false;

  const from = minutesOfDay(prefs.quietFrom);
  const to = minutesOfDay(prefs.quietTo);
  const at = now.getUTCHours() * 60 + now.getUTCMinutes();

  // An empty window suppresses nothing; a full one would be a way to
  // silence every channel forever through a settings screen.
  if (from === to) return false;

  return from < to ? at >= from && at < to : at >= from || at < to;
}

export function selectChannels(input: {
  readonly prefs: ChannelPreferences;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  readonly now: Date;
}): readonly ChannelDecision[] {
  const quiet =
    input.priority !== NotificationPriority.CRITICAL && inQuietHours(input.prefs, input.now);

  return CHANNELS.map((channel) => {
    if (!channelEnabled(input.prefs, channel)) {
      return { channel, status: 'skipped', reason: 'channel-off' } as const;
    }

    if (!categoryEnabled(input.prefs, input.category)) {
      return { channel, status: 'skipped', reason: 'category-off' } as const;
    }

    if (quiet) return { channel, status: 'skipped', reason: 'quiet-hours' } as const;

    return { channel, status: 'pending', reason: null } as const;
  });
}

/** The column defaults, for a user who has never opened the settings screen. */
export const DEFAULT_PREFERENCES: ChannelPreferences = {
  channelEmail: true,
  channelSms: false,
  channelPush: true,
  channelDesktop: false,
  channelInApp: true,
  quietHoursEnabled: false,
  quietFrom: new Date(Date.UTC(1970, 0, 1, 22, 0, 0)),
  quietTo: new Date(Date.UTC(1970, 0, 1, 7, 0, 0)),
  catAppointments: true,
  catMedicalRecords: true,
  catLaboratory: true,
  catPharmacy: true,
  catPatients: true,
  catAi: true,
  catSystem: true,
  catSecurity: true,
};
