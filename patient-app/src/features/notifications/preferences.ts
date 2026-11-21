import type { MessageKey } from '@/i18n';
import type { NotificationCategory } from '@/types/vocabularies';

import {
  type NotificationChannel,
  type NotificationPreferences,
  type QuietHours,
  type TimeOfDay,
} from './model/types';

/**
 * The rules behind the preferences screen — checklist O-06.
 *
 * Pure functions, in their own module, for the reason `ErrorState`'s
 * `present()` is: the interesting parts of this feature are *rules*
 * rather than pixels — a category that cannot be switched off, a quiet
 * window that has to be two different times — and a rule tested through
 * a render is a rule tested once, in whichever language the test mounted.
 *
 * ── What the screen shows, and what it carries ───────────────────────
 *
 * The row has five channels and eight categories. The screen renders
 * four and six. The gap is not an oversight and it is not laziness:
 *
 * | Left out    | Why |
 * |---|---|
 * | `desktop`   | A browser notification, on a phone. There is nothing here to deliver it |
 * | `patients`  | A clinician's roster feed. A patient is not notified *about patients* |
 * | `ai`        | Phase K is closed on **AD-4** — no provider, no clinical owner. A preference row for a feature that does not exist is a promise this app has spent the whole of Phase K not making |
 *
 * All three are **preserved verbatim** through every edit. A `PUT` is a
 * whole-row write, so dropping a field a screen does not render is how
 * the same account's setting on another client silently flips.
 */

/** Channels a phone can actually deliver, in the order they are shown. */
export const PATIENT_CHANNELS: readonly NotificationChannel[] = ['push', 'inApp', 'email', 'sms'];

/** Categories a patient can receive, in the order they are shown. */
export const PATIENT_CATEGORIES: readonly NotificationCategory[] = [
  'appointments',
  'medical-records',
  'laboratory',
  'pharmacy',
  'system',
  'security',
];

/**
 * Categories the server refuses to switch off (422; `CHECK
 * (cat_security = true)`).
 *
 * A set rather than a `category === 'security'` comparison because the
 * *shape* is the point: if a second one is ever locked, it is added here
 * and every consumer follows, instead of a second special case appearing
 * next to the first.
 */
export const LOCKED_CATEGORIES: readonly NotificationCategory[] = ['security'];

export function isCategoryLocked(category: NotificationCategory): boolean {
  return LOCKED_CATEGORIES.includes(category);
}

/**
 * Channels this build cannot deliver on, whatever the row says.
 *
 * Push has no provider and no registration endpoint (**BE-12**, O-03),
 * which `push-registration.ts` documents rather than fakes. The screen
 * renders the row as unavailable and says so, instead of offering a
 * switch that changes a boolean nobody reads — a patient who turns push
 * *on* and hears nothing has been told something untrue.
 */
export const UNAVAILABLE_CHANNELS: readonly NotificationChannel[] = ['push'];

export function isChannelAvailable(channel: NotificationChannel): boolean {
  return !UNAVAILABLE_CHANNELS.includes(channel);
}

/** `HH:MM`, 24-hour, zero-padded. Not a display format — see `TimeOfDay`. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: string): value is TimeOfDay {
  return TIME_PATTERN.test(value);
}

/**
 * What is wrong with a quiet window, as a catalogue key, or `null`.
 *
 * A key rather than a sentence so the rule holds in every language and
 * stays assertable without mounting a provider.
 *
 * A window that crosses midnight (`22:00` → `07:00`) is the normal case,
 * not an error — which is why this checks the two values *are* times and
 * that they differ, and nothing else. `from === to` is the one genuinely
 * meaningless window: it reads as either zero hours or twenty-four, and
 * the server should not have to guess which the patient meant.
 */
export function quietHoursIssue(from: string, to: string): MessageKey | null {
  if (!isTimeOfDay(from) || !isTimeOfDay(to)) return 'notificationPrefs.quietHours.invalid';
  if (from === to) return 'notificationPrefs.quietHours.identical';
  return null;
}

/** Immutable channel edit. Unavailable channels are not editable at all. */
export function setChannel(
  preferences: NotificationPreferences,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationPreferences {
  if (!isChannelAvailable(channel)) return preferences;
  return { ...preferences, channels: { ...preferences.channels, [channel]: enabled } };
}

/**
 * Immutable category edit.
 *
 * Turning a locked category off returns the preferences **unchanged**
 * rather than throwing. The screen never offers the control, so reaching
 * here means something else did — and a rule enforced by refusing is a
 * rule that still holds when the next caller forgets it. Turning one
 * *on* is allowed: it is already the only legal value.
 */
export function setCategory(
  preferences: NotificationPreferences,
  category: NotificationCategory,
  enabled: boolean,
): NotificationPreferences {
  if (!enabled && isCategoryLocked(category)) return preferences;
  return { ...preferences, categories: { ...preferences.categories, [category]: enabled } };
}

/** Immutable quiet-hours edit. Validation is the caller's — see `quietHoursIssue`. */
export function setQuietHours(
  preferences: NotificationPreferences,
  patch: Partial<QuietHours>,
): NotificationPreferences {
  return { ...preferences, quietHours: { ...preferences.quietHours, ...patch } };
}

/**
 * The defaults from the schema's own `DEFAULT`s (G7), not a guess.
 *
 * Used by the fixture adapter and by nothing else: a screen that fell
 * back to these when a read failed would show a patient settings that
 * are not theirs.
 */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  channels: { push: true, inApp: true, email: true, sms: false, desktop: false },
  categories: {
    appointments: true,
    'medical-records': true,
    laboratory: true,
    pharmacy: true,
    patients: true,
    ai: true,
    system: true,
    security: true,
  },
  quietHours: { enabled: false, from: '22:00', to: '07:00' },
};
