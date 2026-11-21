/**
 * Request validation for Platform Settings (API §19, RM M24).
 *
 * ## The eleven slices are transcribed, not designed
 *
 * Every field name, type and union below is copied from
 * `frontend/src/features/admin/admin-settings.types.ts`, which the
 * source-of-truth hierarchy ranks first. The panels already display
 * these values to an administrator; a backend that spelled one
 * differently would validate a field nobody can send, and silently
 * ignore the one they do.
 *
 * ## `AdminSectionSlug` is transcribed too
 *
 * `general.defaultSection` is typed `AdminSectionSlug` in the frontend —
 * the twenty-two administration sections declared in
 * `frontend/src/routes/index.ts`. A free string here would let an
 * administrator set a landing page the shell cannot route to, and the
 * failure would surface as a blank screen on their next sign-in rather
 * than as a rejected save.
 *
 * ## Derived and server-owned fields are absent by construction
 *
 * `ApiKey.prefix`, `ApiKey.createdAt`, `ApiKey.revoked`, `Backup.sizeMb`
 * and `IntegrationSetting.lastSyncAt` appear in no schema here, so there
 * is no request shape that could carry one. The rule M23 established —
 * a client that can send a derived field can also freeze it — holds
 * across this module unchanged.
 */

import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);

/**
 * The administration sections, verbatim from `routes/index.ts`.
 * `general.defaultSection` is one of these and nothing else.
 */
export const ADMIN_SECTION_SLUGS = [
  'overview',
  'clinic',
  'doctors',
  'patients',
  'appointments',
  'staff',
  'departments',
  'rooms',
  'resources',
  'schedule',
  'holidays',
  'shifts',
  'queue',
  'waiting-room',
  'announcements',
  'policies',
  'templates',
  'communications',
  'logs',
  'reports',
  'settings',
  'preferences',
  'profile',
] as const;

/* ── The eleven form slices ──────────────────────────────────────── */

export const generalSchema = z.object({
  platformName: required(80),
  supportEmail: z.string().trim().email().max(254).toLowerCase(),
  defaultSection: z.enum(ADMIN_SECTION_SLUGS),
  maintenanceMode: z.boolean(),
  maintenanceMessage: text(300),
});

export const organizationSchema = z.object({
  name: required(120),
  legalName: text(160),
  taxId: text(40),
  phone: text(30),
  website: text(200),
  addressLine: text(200),
  city: text(80),
  country: text(80),
});

export const brandingSchema = z.object({
  productName: required(60),
  tagline: text(120),
  loginWelcome: text(200),
  showPoweredBy: z.boolean(),
});

export const localizationSchema = z.object({
  // A one-member union, and deliberately so: the frontend types this
  // `'en'`, the i18n bundle ships one locale, and a settings panel that
  // accepted `fr` would persist a language nothing renders.
  language: z.literal('en'),
  timezone: required(60),
  dateFormat: z.enum(['DMY', 'MDY', 'ISO']),
  timeFormat: z.enum(['12h', '24h']),
  firstDayOfWeek: z.enum(['monday', 'sunday']),
  currency: z.enum(['USD', 'EUR', 'GBP']),
});

/** `HH:MM`, the same 24-hour shape M23.3's working week validates. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const notificationsSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
  dailyDigest: z.boolean(),
  criticalOnly: z.boolean(),
  quietFrom: z.string().regex(TIME_OF_DAY, 'Expected "HH:MM"'),
  // Deliberately **not** refined to be after `quietFrom`: quiet hours
  // that wrap midnight (22:00 → 07:00) are the seeded default and the
  // ordinary case, so a `from < to` rule would reject the value the
  // platform ships with.
  quietTo: z.string().regex(TIME_OF_DAY, 'Expected "HH:MM"'),
});

export const securitySchema = z.object({
  twoFactorRequired: z.boolean(),
  // The four numeric bounds are the ones `config/policy.types.ts`
  // already enforces when it layers this slice over the environment
  // (ADR-020 §4). Validating them here as well means an administrator
  // gets a 422 naming the field, rather than a save that appears to
  // succeed and is then discarded by `PolicyService` with a log line
  // nobody reads.
  passwordExpiryDays: z.number().int().positive().max(3650),
  sessionTimeoutMinutes: z.number().int().positive().max(1440),
  loginAttemptLimit: z.number().int().positive().max(100),
  singleSessionPerUser: z.boolean(),
});

export const emailSchema = z.object({
  fromName: required(80),
  fromAddress: z.string().trim().email().max(254).toLowerCase(),
  // Optional in the panel, so the empty string is legal and an address
  // is required only when one is given.
  replyTo: z.union([z.literal(''), z.string().trim().email().max(254).toLowerCase()]),
  smtpHost: text(200),
  smtpPort: z.number().int().min(1).max(65535),
  signature: text(500),
});

export const smsSchema = z.object({
  enabled: z.boolean(),
  senderId: text(20),
  defaultCountryCode: text(6),
  deliveryReports: z.boolean(),
});

export const backupSchema = z.object({
  autoBackup: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  retainCount: z.number().int().positive().max(365),
});

export const retentionSchema = z.object({
  // ADR-007's four retention periods. The floors are not invented: a
  // zero or negative window means "delete everything now", and
  // `retention.autoPurge` can make that literal.
  patientRecordYears: z.number().int().positive().max(100),
  auditLogDays: z.number().int().positive().max(36500),
  messageDays: z.number().int().positive().max(36500),
  autoPurge: z.boolean(),
});

export const privacySchema = z.object({
  productAnalytics: z.boolean(),
  errorReporting: z.boolean(),
  cookieBanner: z.boolean(),
  dpaAccepted: z.boolean(),
});

/**
 * The eleven slice keys of §19.2, in the contract's order.
 *
 * A `Record` keyed by this union, rather than a lookup with a fallback:
 * adding a twelfth slice is then a type error here instead of a runtime
 * 404 discovered by a user.
 */
export const SETTINGS_SLICES = [
  'general',
  'organization',
  'branding',
  'localization',
  'notifications',
  'security',
  'email',
  'sms',
  'backup',
  'retention',
  'privacy',
] as const;

export type SettingsSlice = (typeof SETTINGS_SLICES)[number];

export const SLICE_SCHEMAS: Record<SettingsSlice, z.ZodTypeAny> = {
  general: generalSchema,
  organization: organizationSchema,
  branding: brandingSchema,
  localization: localizationSchema,
  notifications: notificationsSchema,
  security: securitySchema,
  email: emailSchema,
  sms: smsSchema,
  backup: backupSchema,
  retention: retentionSchema,
  privacy: privacySchema,
};

export function isSettingsSlice(value: string): value is SettingsSlice {
  return (SETTINGS_SLICES as readonly string[]).includes(value);
}

/**
 * The two slices §19.2 calls risky: "**security & retention slices
 * require typed confirmation** (`confirm: true` + audited consequence
 * text)".
 *
 * Security changes who can get in; retention decides what is destroyed
 * and when — `autoPurge` turns a shortened window into deletion. Both
 * are changes whose consequence is not visible on the panel that makes
 * them, which is exactly what a typed confirmation is for.
 */
export const CONFIRMED_SLICES: readonly SettingsSlice[] = ['security', 'retention'];

export function requiresConfirmation(slice: SettingsSlice): boolean {
  return CONFIRMED_SLICES.includes(slice);
}

/**
 * The PATCH envelope — API §19.2.
 *
 * `updatedAt` is the optimistic-concurrency token and is **[DERIVED]**:
 * `AdminSettingsDocument` has no version field, because the mock
 * persisted to localStorage where there was no second writer. §19.2
 * requires "optimistic concurrency", so the document read carries a
 * `revisions` map and a write quotes the slice's own value back. It is
 * per slice rather than per document on purpose — a document-wide
 * version would 409 a branding edit because somebody else saved the SMS
 * panel, and two administrators editing different panels are not in
 * conflict.
 *
 * `confirm` defaults to `false` rather than being optional, so the
 * security and retention checks compare a boolean instead of
 * distinguishing "absent" from "false" — a distinction that carries no
 * meaning here and is a reliable source of bugs where it does not.
 */
export const slicePatchSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  confirm: z.boolean().default(false),
  /**
   * The consequence text the administrator was shown. Recorded in the
   * audit event verbatim, which is the whole point: an audit row saying
   * "security slice changed" does not record what the person was told
   * they were agreeing to.
   */
  consequence: text(300).optional(),
  value: z.unknown(),
});

export type SlicePatchBody = z.infer<typeof slicePatchSchema>;

/* ── API keys (§19.4, M24.3) ─────────────────────────────────────── */

export const apiKeySchema = z.object({ label: required(120) });
export type ApiKeyBody = z.infer<typeof apiKeySchema>;

/* ── Integrations (§19.5, M24.4) ─────────────────────────────────── */

/**
 * Integration credentials are an opaque string map.
 *
 * Nothing in the frontend model, the API contract or DB §L2 states a
 * shape — `platform_integrations.config_enc` is one `bytea` column and
 * `IntegrationSetting` carries no config at all. Inventing a per-provider
 * schema would be inventing a product rule, so the map is validated for
 * *size and type* only and encrypted whole.
 *
 * `baseUrl` is the one key this module reads, and only because §19.5's
 * own `test-connection` has to have somewhere to connect to. It is named
 * in ADR-040 rather than left implicit, and a config without one makes
 * `test-connection` a 422 naming the missing key instead of a silent
 * success.
 */
export const integrationConfigSchema = z
  .record(z.string().trim().min(1).max(60), z.string().max(2000))
  .refine((value) => Object.keys(value).length <= 25, {
    message: 'At most 25 configuration keys',
  });

export const integrationPatchSchema = z.object({
  description: text(300).optional(),
  config: integrationConfigSchema.optional(),
  connected: z.boolean().optional(),
  /**
   * §19.5's "P4 consequence summary". Required to *disable* a connected
   * integration, for the same reason M24.2's two slices require it: the
   * consequence — appointments stop syncing, reminders stop sending — is
   * not visible on the row being toggled.
   */
  confirm: z.boolean().default(false),
  consequence: text(300).optional(),
});

export type IntegrationPatchBody = z.infer<typeof integrationPatchSchema>;
