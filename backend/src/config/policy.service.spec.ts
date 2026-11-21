import { describe, expect, it } from 'vitest';

import { ConfigService } from './config.service';
import type { Env } from './env.schema';
import { PolicyService } from './policy.service';
import type { PlatformPolicySource, PolicyOverrides } from './policy.types';

/**
 * The M3.3 verification: "unit tests prove DB value overrides env
 * default and fallback works."
 *
 * The layering is the whole feature. An administrator changing the login
 * attempt limit in the security panel (API §19.2) has to reach the
 * limiter that enforces it, and a platform-settings row that has never
 * been written must not silently zero out a policy.
 */

/** Only the keys `PolicyService.defaults` reads. */
const ENV_DEFAULTS = {
  SECURITY_TWO_FACTOR_REQUIRED: false,
  SECURITY_PASSWORD_EXPIRY_DAYS: 180,
  SECURITY_SESSION_TIMEOUT_MINUTES: 30,
  SECURITY_LOGIN_ATTEMPT_LIMIT: 5,
  SECURITY_SINGLE_SESSION_PER_USER: false,
  JWT_ACCESS_TTL: 900,
  REFRESH_TTL_DEFAULT: 43_200,
  REFRESH_TTL_REMEMBER: 2_592_000,
  SECURITY_LOCKOUT_MINUTES: 15,
  // M24.6 — the env layer under the `general` slice's maintenance flag.
  MAINTENANCE_MODE: false,
  MAINTENANCE_MESSAGE: '',
  RETENTION_AUDIT_LOG_DAYS: 365,
} as const;

function buildService(source: PlatformPolicySource): PolicyService {
  const config = new ConfigService(ENV_DEFAULTS as unknown as Env);
  return new PolicyService(config, source);
}

const sourceReturning = (overrides: PolicyOverrides): PlatformPolicySource => ({
  load: () => Promise.resolve(overrides),
});

describe('PolicyService (RM M3.3)', () => {
  it('layers the maintenance flag from the general slice (M24.6)', async () => {
    // The one non-security field that layers, and the one whose default
    // a `??` would get wrong in the direction that matters: a platform
    // taken *out* of maintenance must not stay in it.
    const on = await buildService(
      sourceReturning({ maintenanceMode: true, maintenanceMessage: 'Back at 02:00 UTC' }),
    ).current();

    expect(on.maintenanceMode).toBe(true);
    expect(on.maintenanceMessage).toBe('Back at 02:00 UTC');

    const off = await buildService(sourceReturning({ maintenanceMode: false })).current();
    expect(off.maintenanceMode).toBe(false);
  });

  it('falls back to the environment when the source contributes nothing', async () => {
    // `EnvOnlyPolicySource` still returns `{}` — it is what
    // `ConfigModule` falls back to when no database delegate is
    // registered, which is every unit test and every boot without the
    // shared kernel (M24.6).
    const policy = await buildService(sourceReturning({})).current();

    expect(policy).toEqual({
      twoFactorRequired: false,
      passwordExpiryDays: 180,
      sessionTimeoutMinutes: 30,
      loginAttemptLimit: 5,
      singleSessionPerUser: false,
      accessTtlSeconds: 900,
      refreshTtlDefaultSeconds: 43_200,
      refreshTtlRememberSeconds: 2_592_000,
      // M6.2's lockout duration. Layered here rather than read from the
      // environment at the enforcement point, so M24's panel field can
      // override it without touching the login service.
      lockoutMinutes: 15,
      // M24.6 — from the `general` slice, layered the same way. The
      // middleware that honours it is M38.3.
      maintenanceMode: false,
      maintenanceMessage: '',
      // M28.5 — the window the audit partition sweep enforces.
      auditLogDays: 365,
    });
  });

  it('lets a database value override the environment default', async () => {
    const policy = await buildService(
      sourceReturning({ loginAttemptLimit: 3, twoFactorRequired: true }),
    ).current();

    expect(policy.loginAttemptLimit).toBe(3);
    expect(policy.twoFactorRequired).toBe(true);
  });

  it('overrides only the keys it supplies', async () => {
    const policy = await buildService(sourceReturning({ passwordExpiryDays: 90 })).current();

    expect(policy.passwordExpiryDays).toBe(90);
    expect(policy.loginAttemptLimit).toBe(5);
    expect(policy.sessionTimeoutMinutes).toBe(30);
  });

  it('treats an explicit undefined as "not set", not as a value', async () => {
    // A platform-settings column added by a later migration and still
    // null must contribute nothing rather than erase the default.
    const policy = await buildService(sourceReturning({ loginAttemptLimit: undefined })).current();

    expect(policy.loginAttemptLimit).toBe(5);
  });

  it('overrides a false boolean correctly rather than treating it as absent', async () => {
    const alwaysOn = new ConfigService({
      ...ENV_DEFAULTS,
      SECURITY_TWO_FACTOR_REQUIRED: true,
    } as unknown as Env);
    const service = new PolicyService(alwaysOn, sourceReturning({ twoFactorRequired: false }));

    // `??` or a truthiness check here would silently keep 2FA on after
    // an administrator turned it off.
    expect((await service.current()).twoFactorRequired).toBe(false);
  });

  it('ignores an invalid override and keeps that one default', async () => {
    // A negative limit would lock every user out on their first attempt.
    const policy = await buildService(
      sourceReturning({ loginAttemptLimit: -1, passwordExpiryDays: 90 }),
    ).current();

    expect(policy.loginAttemptLimit).toBe(5);
    // One bad column costs one setting, not the whole policy.
    expect(policy.passwordExpiryDays).toBe(90);
  });

  it('falls back to the environment when the source fails', async () => {
    // A settings-table outage must not take down login for everyone.
    const failing: PlatformPolicySource = {
      load: () => Promise.reject(new Error('connection refused')),
    };

    const policy = await buildService(failing).current();
    expect(policy.loginAttemptLimit).toBe(5);
    expect(policy.accessTtlSeconds).toBe(900);
  });

  it('exposes the environment layer on its own', async () => {
    const service = buildService(sourceReturning({ loginAttemptLimit: 3 }));

    expect(service.defaults.loginAttemptLimit).toBe(5);
    expect((await service.current()).loginAttemptLimit).toBe(3);
  });
});
