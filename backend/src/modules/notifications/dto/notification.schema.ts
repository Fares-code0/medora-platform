/**
 * Query validation for the notification feed (API §10.1).
 *
 * `status` is the contract's own vocabulary — `active | unread | read |
 * archived` — rather than a boolean pair, because "active" (not archived)
 * and "unread" are different questions and the client asks both.
 */

import { z } from 'zod';

import { CATEGORY_VALUES, PRIORITY_VALUES } from './notification-enums';

export const notificationQuerySchema = z.object({
  category: z.enum(CATEGORY_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  status: z.enum(['active', 'unread', 'read', 'archived']).default('active'),
  /**
   * API §10.1's free-text filter. Trimmed and length-capped before it
   * reaches a `contains`: an unbounded pattern is a sequential scan a
   * caller can ask for repeatedly, and an all-whitespace one is not a
   * filter at all.
   */
  q: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

/**
 * The body of `/archive`, `/favorite` and `/pin` (API §10.2).
 *
 * The route name says what the action means and `value` says which way
 * it goes, defaulting to `true` so `POST …/archive` with no body reads
 * as it looks. It is **not** a toggle: the client is optimistic
 * (§10.2 — "rollback on failure"), and a toggle cannot be rolled back
 * safely — two clicks racing each other would leave the row in whichever
 * state the second write happened to compute, and the client's undo
 * would then flip a value it never saw.
 */
export const notificationFlagSchema = z.object({
  value: z.boolean().default(true),
});

export type NotificationFlagBody = z.infer<typeof notificationFlagSchema>;

/**
 * `PUT /me/notification-preferences` (API §10.5).
 *
 * A full document rather than a patch, because `PUT` is what the
 * contract names and a partial `PUT` would leave a client unable to tell
 * an omitted channel from one it meant to switch off.
 *
 * `categories.security` is `z.literal(true)`: §10.5 says it "must remain
 * true (422 otherwise)", and a literal answers 422 through the ordinary
 * validation path rather than needing a hand-written check. DB §G7's
 * CHECK is the backstop under it — a UI-only guarantee is one API client
 * away from a user who never learns their password was changed.
 */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const notificationPreferencesSchema = z.object({
  channels: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean(),
    desktop: z.boolean(),
    inApp: z.boolean(),
  }),
  quietHours: z.object({
    enabled: z.boolean(),
    from: z.string().regex(TIME_OF_DAY, 'Expected "HH:MM" in 24-hour time'),
    to: z.string().regex(TIME_OF_DAY, 'Expected "HH:MM" in 24-hour time'),
  }),
  categories: z.object({
    appointments: z.boolean(),
    'medical-records': z.boolean(),
    laboratory: z.boolean(),
    pharmacy: z.boolean(),
    patients: z.boolean(),
    ai: z.boolean(),
    system: z.boolean(),
    security: z.literal(true),
  }),
});

export type NotificationPreferencesBody = z.infer<typeof notificationPreferencesSchema>;
