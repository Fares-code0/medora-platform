/**
 * Request shapes for the account-security surface (API §2.6, §2.7, §2.8).
 *
 * The device platforms are the `DevicePlatform` enum's seven members as
 * the wire spells them (ADR-023 §2 — the DB value *is* the API
 * vocabulary). The frontend's `TrustedDevice.platform` names four of
 * them; the schema accepts all seven because the column does, and a
 * mobile client registering `ios` and a desktop registering `windows`
 * are the same route.
 */

import { z } from 'zod';

export const DEVICE_PLATFORMS = [
  'windows',
  'mac',
  'ios',
  'android',
  'desktop',
  'mobile',
  'tablet',
] as const;

export type DevicePlatformWire = (typeof DEVICE_PLATFORMS)[number];

/**
 * `POST /me/devices`.
 *
 * `name` is the user's own label for a machine ("Amelia's MacBook"), so
 * it is trimmed and bounded to the column width rather than pattern
 * matched — there is no sensible character class for a device nickname,
 * and rejecting one is an obstacle without a security benefit.
 */
export const registerDeviceSchema = z.object({
  name: z.string().trim().min(1, 'Name a device').max(80, 'Keep the name under 80 characters'),
  platform: z.enum(DEVICE_PLATFORMS),
  /**
   * Marks this as the device the caller is signing in from. Optional and
   * defaulting to false: the flag drives the "this device" badge, and
   * claiming it for a device the user is not on would misrepresent which
   * machine the row refers to.
   */
  current: z.boolean().default(false),
  /**
   * The push provider's token for this device (M41.2, mobile contract
   * P5.8). Optional: a device can be trusted without accepting push.
   * Opaque to the API — FCM, APNs and Expo tokens differ in shape — so
   * only its length is bounded, by the column.
   */
  pushToken: z.string().trim().min(1).max(1024).optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

/**
 * Page parameters shared by the login-history and activity feeds.
 *
 * `z.coerce` because query strings arrive as strings; `max(100)` so a
 * caller cannot ask for the whole table in one request — the ceiling the
 * notification feed already uses (API §0.2's pagination envelope).
 */
export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
