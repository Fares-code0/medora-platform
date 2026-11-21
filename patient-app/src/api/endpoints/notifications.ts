import { z } from 'zod';

import { envelopeSchema, paginatedSchema, parseResponse } from '@/schemas/envelope';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_PRIORITIES } from '@/types/vocabularies';

import { apiClient } from '../client';

/**
 * The HTTP notification adapter.
 *
 * ── These are `/notifications`, NOT `/me/notifications` ──────────────
 *
 * An earlier revision of the contract specified `/me/notifications` and
 * this tree's traceability register copied it. Both were wrong. API §10
 * already defines this surface for **any authenticated user**, because
 * the feed is scoped by `notifications.recipient_id` and is therefore
 * self-scoped by construction — one route tree and one code path serve a
 * doctor and a patient identically. A patient-specific route over the
 * same table would be the parallel model the design forbids, and would
 * leave two places to get the ownership predicate right.
 *
 * Transcribed from `notification.controller.ts`, contract §5:
 *
 *   GET  /notifications               P5.1  ✅ LIVE
 *   GET  /notifications/badge-counts  P5.2  ✅ LIVE
 *   POST /notifications/{id}/read     P5.3  ✅ LIVE  (204)
 *   POST /notifications/{id}/unread   P5.4  ✅ LIVE  (204)
 *   POST /notifications/read-all      P5.5  ✅ LIVE  (200, { updated })
 *
 *   GET  /me/notification-preferences P5.7  ✅ LIVE  (M19.4)
 *   PUT  /me/notification-preferences P5.7  ✅ LIVE  (whole-row write)
 *
 * `/archive`, `/favorite`, `/pin` and `clear-read` (P5.6) are not called
 * by this client, and push-device registration (P5.8) has no provider, so
 * no path string for any of them appears here.
 *
 * ── `related` carries ids and never linked content ───────────────────
 *
 * A notification announcing a lab result is not a way to read one:
 * following the id has to go through a route that enforces its own
 * authorization. **"The patient was notified" must never be read as "the
 * patient may see it"** — which is why the mapper derives a deep link
 * only for entities this client can actually open today.
 */

const relatedSchema = z.object({
  patientId: z.string().nullable(),
  recordId: z.string().nullable(),
  labOrderId: z.string().nullable(),
  prescriptionId: z.string().nullable(),
  appointmentId: z.string().nullable(),
});

/**
 * `category` and `priority` are checked against this client's own
 * vocabularies, which `parity.test.ts` binds to the Prisma enums. Note
 * `medical-records` is hyphenated on the wire — `medical_records` is the
 * database spelling and is a 422 on the way in, so it would be a
 * regression on the way out.
 */
const notificationSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  category: z.enum(NOTIFICATION_CATEGORIES),
  priority: z.enum(NOTIFICATION_PRIORITIES),
  kind: z.string(),
  sender: z.string(),
  readAt: z.string().nullable(),
  archived: z.boolean(),
  favorite: z.boolean(),
  pinned: z.boolean(),
  createdAt: z.string().min(1),
  related: relatedSchema,
});

const badgeCountsSchema = z.object({
  notifications: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
});

/**
 * `GET`/`PUT /me/notification-preferences` (API §10.5, RM M19.4) — the
 * `notification_preferences` row, transcribed from the backend's
 * `notificationPreferencesSchema` and `NotificationPreferencesView`. The
 * same shape goes both ways: a `PUT` is a whole-row write.
 *
 * Strict on the categories: an unknown key is a contract change, not a
 * setting to drop on the next write. `security` is read as a boolean
 * rather than `true` — the server's CHECK holds it, and a row that ever
 * read otherwise should render, not crash the screen.
 */
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const preferencesSchema = z.object({
  channels: z
    .object({
      email: z.boolean(),
      sms: z.boolean(),
      push: z.boolean(),
      desktop: z.boolean(),
      inApp: z.boolean(),
    })
    .strict(),
  quietHours: z
    .object({ enabled: z.boolean(), from: timeOfDaySchema, to: timeOfDaySchema })
    .strict(),
  categories: z
    .object(
      Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, z.boolean()])) as {
        [K in (typeof NOTIFICATION_CATEGORIES)[number]]: z.ZodBoolean;
      },
    )
    .strict(),
});

const feedResponseSchema = envelopeSchema(paginatedSchema(notificationSchema));
const badgeResponseSchema = envelopeSchema(badgeCountsSchema);
const readAllResponseSchema = envelopeSchema(z.object({ updated: z.number().int().nonnegative() }));

const preferencesResponseSchema = envelopeSchema(preferencesSchema);

export type WireNotification = z.infer<typeof notificationSchema>;
export type WireNotificationPreferences = z.infer<typeof preferencesSchema>;
export type WireBadgeCounts = z.infer<typeof badgeCountsSchema>;

export const notificationEndpoints = {
  /** `status` defaults to `active` server-side, meaning not archived. */
  async feed(query: { readonly page?: number | undefined } = {}) {
    const raw = await apiClient.get<unknown>('notifications', {
      params: { page: query.page },
    });
    return parseResponse('GET /notifications', feedResponseSchema, raw);
  },

  /**
   * The foreground poll target — API §10.4 requires it be O(1)-cheap,
   * and it is two indexed aggregates returning two integers.
   */
  async badgeCounts() {
    const raw = await apiClient.get<unknown>('notifications/badge-counts');
    return parseResponse('GET /notifications/badge-counts', badgeResponseSchema, raw);
  },

  /**
   * 204, and **idempotent**: marking an already-read notification read
   * succeeds. That is what makes an optimistic client safe to retry
   * after a flaky connection — a retry cannot roll back a state that was
   * already correct.
   *
   * Someone else's notification and an unknown id both answer 404, and
   * the row stays unread.
   */
  async markRead(notificationId: string): Promise<void> {
    await apiClient.post<unknown>(`notifications/${encodeURIComponent(notificationId)}/read`);
  },

  async markUnread(notificationId: string): Promise<void> {
    await apiClient.post<unknown>(`notifications/${encodeURIComponent(notificationId)}/unread`);
  },

  /**
   * 200 with `{ updated }`. The count lets a client reconcile its badge
   * without a second fetch; it is scoped to the caller and never touches
   * another user's rows.
   */
  async markAllRead() {
    const raw = await apiClient.post<unknown>('notifications/read-all');
    return parseResponse('POST /notifications/read-all', readAllResponseSchema, raw);
  },

  /** The caller's own row; the server answers its defaults when none is stored. */
  async preferences() {
    const raw = await apiClient.get<unknown>('me/notification-preferences');
    return parseResponse('GET /me/notification-preferences', preferencesResponseSchema, raw);
  },

  /**
   * A whole-row write, answered with the row as stored. `security: false`
   * and a malformed quiet window are the server's 422s; the screen never
   * builds either.
   */
  async putPreferences(body: WireNotificationPreferences) {
    const raw = await apiClient.put<unknown>('me/notification-preferences', body);
    return parseResponse('PUT /me/notification-preferences', preferencesResponseSchema, raw);
  },
};
