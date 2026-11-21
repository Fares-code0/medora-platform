import { z } from 'zod';

/**
 * Runtime security policy (RM M3.3).
 *
 * Two layers, resolved in this order:
 *
 *  1. **Environment defaults** — always present, validated at boot.
 *  2. **Platform settings from the database** — what an administrator
 *     edits in the security panel (API §19.2). Arrives at **M24**;
 *     until then the source returns nothing and layer 1 stands.
 *
 * The five administrator-editable fields carry the frontend's exact
 * names from `SecurityPolicySettings`
 * (`frontend/src/features/admin/admin-settings.types.ts`). Renaming
 * between the panel and the enforcement point is how a setting ends up
 * displayed but not applied.
 */
export const securityPolicySchema = z.object({
  /** MG §11.1-4 — enforced per role at login when true. */
  twoFactorRequired: z.boolean(),
  passwordExpiryDays: z.number().int().positive(),
  /** Idle timeout. Distinct from the refresh TTL, which is absolute. */
  sessionTimeoutMinutes: z.number().int().positive(),
  /** MG §11.1-8 — the lockout counter is compared against this. */
  loginAttemptLimit: z.number().int().positive(),
  singleSessionPerUser: z.boolean(),
});

/**
 * Session lifetimes. Separated from the five above because **no
 * administrator field exists for them today** — the security panel has
 * no TTL input, so nothing can override these until M24 adds one
 * (the same gap ADR-006 records for the content-access policy as
 * RA-006.2). They are layered through the same mechanism anyway, so the
 * day that field appears no enforcement code changes.
 */
export const sessionTtlSchema = z.object({
  /** MG §11.1-1 caps this at 900; the env schema rejects more. */
  accessTtlSeconds: z.number().int().positive(),
  refreshTtlDefaultSeconds: z.number().int().positive(),
  refreshTtlRememberSeconds: z.number().int().positive(),
  /**
   * How long a lockout lasts (M6.2). In this group and not the one
   * above for the same reason the TTLs are: the security panel has an
   * attempt *count* and no duration input, so nothing can override it
   * until M24 adds one. It is layered anyway, so that day changes no
   * enforcement code. ADR-025 records that the value is a backend
   * default rather than a transcription.
   */
  lockoutMinutes: z.number().int().positive(),
});

/**
 * Platform mode (RM M24.6).
 *
 * `maintenanceMode` is the one administrator-editable field that is not
 * a security setting, and it is layered through the same mechanism for
 * the same reason: the middleware that honours it (**M38.3**) must read
 * one resolved answer, not choose between an environment variable and a
 * settings row. It comes from the `general` slice, not `security`, which
 * is why it is its own group rather than an addition to the five above.
 */
export const platformModeSchema = z.object({
  maintenanceMode: z.boolean(),
  /** Shown to the users a maintenance window locks out. Never PHI. */
  maintenanceMessage: z.string().max(300),
});

/**
 * Retention (RM M28.5, ADR-007 R1).
 *
 * `auditLogDays` is the window M28.5's partition sweep enforces, and it
 * comes from the `retention` platform-settings slice for the reason
 * ADR-020 gives: a retention job carrying its own number would delete on
 * a schedule different from the one the panel shows an administrator.
 *
 * Only the audit window is here. The other three of ADR-007's periods —
 * `patientRecordYears`, `messageDays`, `autoPurge` — have no enforcement
 * point yet (M30.2 owns the purges), and a policy key nothing reads is a
 * claim that something is enforced. They join when their job does.
 */
export const retentionPolicySchema = z.object({
  auditLogDays: z.number().int().positive(),
});

export const policySchema = securityPolicySchema
  .merge(sessionTtlSchema)
  .merge(platformModeSchema)
  .merge(retentionPolicySchema);

export type PolicySettings = z.infer<typeof policySchema>;

/**
 * What a source may contribute. Every key optional: a platform-settings
 * row that has never been edited, or a column added by a later
 * migration and still null, contributes nothing rather than a zero.
 */
export type PolicyOverrides = {
  readonly [K in keyof PolicySettings]?: PolicySettings[K] | undefined;
};

/**
 * Implemented by M24 against the `platform_settings` table. Until then
 * `EnvOnlyPolicySource` returns `{}`.
 *
 * `load()` may reject — the database can be down — and `PolicyService`
 * treats that as "no overrides" rather than propagating. A settings
 * outage that locked every user out of logging in would turn a
 * convenience feature into a total one.
 */
export interface PlatformPolicySource {
  load(): Promise<PolicyOverrides>;
}

/** DI token — inject the interface, never a concrete class. */
export const PLATFORM_POLICY_SOURCE = Symbol('PLATFORM_POLICY_SOURCE');

/**
 * The database-backed source, when one is registered (RM M24.6).
 *
 * ## Why this second token exists
 *
 * Reading `platform_settings` needs the Prisma client, which lives in
 * the shared kernel — and lint zone 6 forbids `config/` importing the
 * kernel, precisely so configuration does not depend on the things it
 * configures. So the implementation lives in
 * `shared/platform-policy/`, and `ConfigModule` binds
 * `PLATFORM_POLICY_SOURCE` to whatever is registered under **this**
 * token, falling back to `EnvOnlyPolicySource` when nothing is.
 *
 * The dependency therefore points the right way: `config/` declares a
 * token it owns and knows nothing about who fills it, exactly as the
 * modules declare `AUDIT_DISPATCHER` and `FILE_STORAGE`.
 *
 * The alternative — a second `@Global` module exporting
 * `PLATFORM_POLICY_SOURCE` and relying on it being registered after
 * `ConfigModule` — would work today and break silently on the day
 * somebody reorders `app.module.ts`'s imports. Which layer wins should
 * not be a property of a list's order.
 *
 * Injected optionally, so `ConfigModule` still boots alone in a unit
 * test with no database anywhere near it.
 */
export const PLATFORM_POLICY_DELEGATE = Symbol('PLATFORM_POLICY_DELEGATE');
