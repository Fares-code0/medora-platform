/**
 * Slice validation for the Settings Center (API §13.2, RM M22.2).
 *
 * ## The privacy slice is the model's shape, not the contract's prose
 *
 * §13.2 names "profileVisibility, surveyParticipation…" for `privacy`.
 * Neither field exists: `PrivacySettings` in
 * `features/doctor/settings/model/types.ts` is
 * `{ dataSharing, analytics, cookies, aiDataUsage }`, and
 * `user_settings` carries exactly those four columns. The model and the
 * database agree with each other and not with that sentence, and the
 * source-of-truth order puts the frontend model first — so the four are
 * what ship. The contract's list ends in an ellipsis, which reads as
 * illustrative rather than exhaustive.
 *
 * ## Every slice is a full document, and carries `updatedAt`
 *
 * §13.2 requires optimistic concurrency. The client sends the
 * `updatedAt` it read; a mismatch is **409**, because the document is
 * stale rather than the request malformed (ADR-013's rule). Without it,
 * two tabs saving different sections would each overwrite the other's
 * work with the values they loaded minutes ago.
 */

import { z } from 'zod';

/** `PrivacySettings`. */
export const privacySliceSchema = z.object({
  dataSharing: z.boolean(),
  analytics: z.boolean(),
  cookies: z.boolean(),
  aiDataUsage: z.boolean(),
});

/** `WorkflowPreferences`. The unions are the model's own. */
export const preferencesSliceSchema = z.object({
  landingPage: z.enum(['overview', 'patients', 'appointments', 'labs', 'messages']),
  defaultPatientTab: z.enum(['summary', 'records', 'labs', 'prescriptions']),
  defaultRecordsTab: z.enum(['all', 'recent', 'critical']),
  autoSaveDrafts: z.boolean(),
  dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
  timeFormat: z.enum(['12h', '24h']),
  /**
   * An IANA name, length-checked and not enumerated.
   *
   * The column's own comment says why: the tz database moves, so a
   * closed list here would reject a zone Postgres accepts the week
   * after it is added.
   */
  timezone: z.string().trim().min(1).max(60),
});

/**
 * `appearance` and `accessibility` — one table, two slices.
 *
 * `InterfaceSettings` in `services/preferences.ts` and the `theme` /
 * `locale` / `sidebarCollapsed` keys beside it are one row,
 * `user_interface_preferences`. §13.2 names them as two sections because
 * the Settings Center renders two panels; the split is by panel, and
 * each writes only its own columns.
 */
export const appearanceSliceSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  locale: z.string().trim().min(2).max(10),
  density: z.enum(['comfortable', 'compact']),
  sidebarCollapsed: z.boolean(),
});

export const accessibilitySliceSchema = z.object({
  /**
   * 90–130, the contract's own bounds.
   *
   * Stepped by 5 as the slider emits, and the step is checked here
   * because a value between stops would render at a size no control can
   * return to — the same reasoning M16.5 applied to the AI temperature.
   */
  textScale: z
    .number()
    .int()
    .min(90)
    .max(130)
    .refine((value) => value % 5 === 0, 'Expected a multiple of 5'),
  reduceMotion: z.boolean(),
  highContrast: z.boolean(),
  focusRings: z.enum(['default', 'high']),
  keyboardNav: z.boolean(),
});

export const SETTINGS_SECTIONS = [
  'privacy',
  'preferences',
  'appearance',
  'accessibility',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** The envelope every slice patch arrives in. */
export const slicePatchSchema = z.object({
  /**
   * The `updatedAt` the client read. Required, not optional: a patch
   * that could omit it would let any client opt out of the concurrency
   * check by leaving a field off.
   */
  updatedAt: z.string().datetime(),
  value: z.unknown(),
});

export type SlicePatchBody = z.infer<typeof slicePatchSchema>;

export const SLICE_SCHEMAS: Record<SettingsSection, z.ZodTypeAny> = {
  privacy: privacySliceSchema,
  preferences: preferencesSliceSchema,
  appearance: appearanceSliceSchema,
  accessibility: accessibilitySliceSchema,
};

/** API §13.3 — the four integrations, verbatim from `IntegrationId`. */
export const INTEGRATION_IDS = ['google-calendar', 'outlook', 'zoom', 'teams'] as const;

export type IntegrationWireId = (typeof INTEGRATION_IDS)[number];
