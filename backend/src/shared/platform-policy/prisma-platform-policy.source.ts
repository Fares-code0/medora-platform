import { Injectable } from '@nestjs/common';

import type { PlatformPolicySource, PolicyOverrides } from '../../config';
import { PrismaService } from '../database';

/**
 * The database layer of M3.3's policy resolution (RM M24.6).
 *
 * `EnvOnlyPolicySource` returned `{}` for twenty milestones because
 * there was nothing to read. This reads it: the `security` slice
 * supplies the five administrator-editable policy fields, the `general`
 * slice supplies the maintenance flag, and `PolicyService` layers both
 * over the environment.
 *
 * ## It lives in the kernel, and that is a lint rule, not a preference
 *
 * Zone 6 forbids `config/` importing the shared kernel, so the code that
 * needs `PrismaService` cannot live beside `PolicyService`. It is bound
 * to `PLATFORM_POLICY_DELEGATE` — a token `config/` declares and does
 * not implement — so the dependency points from the kernel *up to* the
 * contract, which is the direction every other port in this codebase
 * runs.
 *
 * ## Nothing here throws
 *
 * `PolicyService.current()` treats a rejection as "no overrides" and
 * falls back to the environment, which is right — a settings outage
 * must not take login down. This source additionally refuses to
 * contribute a *malformed* value: a slice holding a string, or a field
 * of the wrong type, contributes nothing rather than an override that
 * `PolicyService` would then have to reject a second time. Both layers
 * are deliberate; this one keeps the log quiet for the ordinary case of
 * a slice that simply has not been created yet.
 *
 * ## No cache
 *
 * Two rows per policy read, on every enforcement point. That is the
 * behaviour M3.3 specifies and M31.1 is where it stops being true — the
 * permission/session cache owns the invalidation story that a cached
 * security policy needs, and inventing one here would be a guess M24's
 * `PATCH` would have to honour.
 */
@Injectable()
export class PrismaPlatformPolicySource implements PlatformPolicySource {
  constructor(private readonly prisma: PrismaService) {}

  async load(): Promise<PolicyOverrides> {
    const rows = await this.prisma.db.platformSetting.findMany({
      where: { key: { in: ['security', 'general', 'retention'] } },
      select: { key: true, value: true },
    });

    const stored = new Map(rows.map((row) => [row.key, asObject(row.value)] as const));
    const security = stored.get('security') ?? {};
    const general = stored.get('general') ?? {};
    const retention = stored.get('retention') ?? {};

    // Built key by key, and every key omitted when the stored value is
    // not of the expected type. `exactOptionalPropertyTypes` makes the
    // difference between "absent" and "undefined" a real one, and
    // `PolicyOverrides` means absent — a present `undefined` would read
    // as a contribution of nothing, which is the same answer by a
    // longer route.
    return {
      ...boolean(security, 'twoFactorRequired'),
      ...integer(security, 'passwordExpiryDays'),
      ...integer(security, 'sessionTimeoutMinutes'),
      ...integer(security, 'loginAttemptLimit'),
      ...boolean(security, 'singleSessionPerUser'),
      ...boolean(general, 'maintenanceMode'),
      ...string(general, 'maintenanceMessage'),
      ...integer(retention, 'auditLogDays'),
    };
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boolean<K extends string>(
  source: Record<string, unknown>,
  key: K,
): Record<K, boolean> | Record<string, never> {
  const value = source[key];
  return typeof value === 'boolean' ? ({ [key]: value } as Record<K, boolean>) : {};
}

function integer<K extends string>(
  source: Record<string, unknown>,
  key: K,
): Record<K, number> | Record<string, never> {
  const value = source[key];
  return typeof value === 'number' && Number.isInteger(value)
    ? ({ [key]: value } as Record<K, number>)
    : {};
}

function string<K extends string>(
  source: Record<string, unknown>,
  key: K,
): Record<K, string> | Record<string, never> {
  const value = source[key];
  return typeof value === 'string' ? ({ [key]: value } as Record<K, string>) : {};
}
