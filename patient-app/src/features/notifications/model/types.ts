import type { PagedResult } from '@/api/paged';
import type { NotificationCategory, NotificationPriority } from '@/types/vocabularies';

/**
 * Notifications.
 *
 * ── The PHI rule for this feature ────────────────────────────────────
 * A notification's title and body appear on a **lock screen**, in the
 * OS's notification history, and in an app-switcher preview. None of
 * those is under Medora's control and none of them is private.
 *
 * So a notification says *that* something happened, never *what*: "Your
 * appointment was confirmed", never "Your appointment with Dr Haddad
 * about chest pain was confirmed". "New lab result available", never the
 * value (checklist O-05). The `entityId` is what the deep link carries,
 * and an id is not PHI.
 *
 * `push-registration.ts` records why push itself is not wired.
 */
export interface PatientNotification {
  readonly id: string;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  /** No names, no diagnoses, no values. */
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
  /** Drives the deep link. An opaque id, never a description. */
  readonly deepLink: string | null;
}

/**
 * One page of the feed.
 *
 * `GET /notifications` is paginated at twenty a page and always has
 * been -- `unreadCount` below already says so, and reads the badge
 * endpoint rather than counting the feed for exactly that reason. The
 * feed itself had no such compensation: it read page one and stopped,
 * so a patient with more than twenty notifications could not reach the
 * older ones, and the badge could report a number larger than anything
 * on the screen.
 */
export type NotificationPage = PagedResult<PatientNotification>;

export interface NotificationService {
  /** `page` is 1-based, as the contract's `page` parameter is. */
  list(page?: number): Promise<NotificationPage>;
  markRead(id: string): Promise<void>;
  /**
   * Puts a row back to unread — checklist O-01.
   *
   * `POST /notifications/{id}/unread` has been live since the feed was,
   * and this port did not name it, so the adapter's `markUnread` was
   * unreachable code. It matters more now that a tap can *navigate*
   * (O-04): opening an appointment from a notification marks the
   * notification read as a side effect, and a patient who wanted to keep
   * it flagged until they had done something about it had no way back.
   */
  markUnread(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  unreadCount(): Promise<number>;

  /**
   * The preference row for the signed-in account (O-06).
   *
   * On the same port as the feed rather than on a port of its own: it is
   * the same feature, the same query prefix and the same sweep on
   * logout, and a second `service.ts` in one feature is a second place
   * for the seam to be selected — which `api/seam.ts` exists to prevent.
   *
   * Over `GET`/`PUT /me/notification-preferences` (P5.7, M19.4) in a
   * production build.
   */
  getPreferences(): Promise<NotificationPreferences>;
  /** A whole-row write, the way a `PUT` is. */
  updatePreferences(preferences: NotificationPreferences): Promise<NotificationPreferences>;
}

/**
 * Delivery channels — checklist O-06.
 *
 * Five, because five is what the row carries: `notification_preferences`
 * (schema G7) has `channel_email`, `channel_sms`, `channel_push`,
 * `channel_desktop` and `channel_in_app`, and this port is a
 * transcription of that row rather than of the screen that renders it.
 *
 * `desktop` is a browser notification and there is no browser here. It
 * is in the type and NOT on the screen, and the two facts belong
 * together: a `PUT` that dropped it would silently switch off a channel
 * the same account uses somewhere else, which is the kind of edit a
 * patient never made and cannot see. `preferences.ts` keeps it whole.
 */
export const NOTIFICATION_CHANNELS = ['push', 'email', 'sms', 'inApp', 'desktop'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * A 24-hour local time, `HH:MM`. The column is a `time`, so this is the
 * wire form and not a display format — `formatTime` is what turns it
 * into something a patient reads.
 */
export type TimeOfDay = string;

export interface QuietHours {
  readonly enabled: boolean;
  readonly from: TimeOfDay;
  readonly to: TimeOfDay;
}

/**
 * What a patient may decide about being contacted.
 *
 * Two rules travel with this type rather than with the screen, because
 * both are server rules the client must not be able to violate by
 * rendering a control:
 *
 * 1. **`categories.security` cannot be turned off.** The server answers
 *    422, and the column carries `CHECK (cat_security = true)`. A
 *    sign-in alert a patient can silence is an account takeover nobody
 *    is told about.
 * 2. **Quiet hours never suppress a `critical` notification.** Quiet
 *    hours are about a phone at 3am; a critical alert is why the phone
 *    is there at all.
 *
 * `preferences.ts` enforces the first and says the second out loud on
 * the screen. Neither is a claim this client can make on its own — both
 * are transcribed from `frontend/DATABASE_SCHEMA_EXTRACTION.md` §G7 and
 * the notifications module's own preference handling.
 */
export interface NotificationPreferences {
  readonly channels: Record<NotificationChannel, boolean>;
  readonly categories: Record<NotificationCategory, boolean>;
  readonly quietHours: QuietHours;
}
