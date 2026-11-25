import { Inject, Injectable, Logger } from '@nestjs/common';

import { ConfigService } from './config.service';
import {
  PLATFORM_POLICY_SOURCE,
  type PlatformPolicySource,
  type PolicyOverrides,
  type PolicySettings,
  policySchema,
} from './policy.types';

/**
 * Resolves the effective security policy (RM M3.3).
 *
 * Everything that enforces policy — the login limiter (M6), the 2FA
 * step-up (M6), password expiry (M8), session handling (M6) — asks this
 * service rather than reading config directly, so there is one answer to
 * "what is the policy right now" and one place where the database layer
 * gets added at M24.
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(PLATFORM_POLICY_SOURCE) private readonly source: PlatformPolicySource,
  ) {}

  /** The env layer alone — what applies when nothing overrides it. */
  get defaults(): PolicySettings {
    const { env } = this.config;
    return {
      twoFactorRequired: env.SECURITY_TWO_FACTOR_REQUIRED,
      passwordExpiryDays: env.SECURITY_PASSWORD_EXPIRY_DAYS,
      sessionTimeoutMinutes: env.SECURITY_SESSION_TIMEOUT_MINUTES,
      loginAttemptLimit: env.SECURITY_LOGIN_ATTEMPT_LIMIT,
      singleSessionPerUser: env.SECURITY_SINGLE_SESSION_PER_USER,
      accessTtlSeconds: env.JWT_ACCESS_TTL,
      refreshTtlDefaultSeconds: env.REFRESH_TTL_DEFAULT,
      refreshTtlRememberSeconds: env.REFRESH_TTL_REMEMBER,
      lockoutMinutes: env.SECURITY_LOCKOUT_MINUTES,
      maintenanceMode: env.MAINTENANCE_MODE,
      maintenanceMessage: env.MAINTENANCE_MESSAGE,
      auditLogDays: env.RETENTION_AUDIT_LOG_DAYS,
    };
  }

  /**
   * The effective policy: database over environment.
   *
   * Not cached. Reading the policy on each enforcement point is correct
   * before there is a database to read it from, and caching a security
   * policy needs an invalidation story that belongs with M24's writes
   * and M31's cache — inventing one here would be a guess that the
   * admin panel's "save" has to honour later.
   */
  async current(): Promise<PolicySettings> {
    const defaults = this.defaults;

    let overrides: PolicyOverrides;
    try {
      overrides = await this.source.load();
    } catch (error) {
      // Fail *open to the defaults*, not closed. The defaults are a
      // complete, valid policy; refusing to answer would take down
      // login for everyone because a settings row could not be read.
      this.logger.error(
        { err: error },
        'Platform policy source failed; using environment defaults',
      );
      return defaults;
    }

    return applyOverrides(defaults, overrides, this.logger);
  }

  /**
   * The effective policy, or a throw when the database layer cannot be read.
   *
   * For a destructive operator command (audit retention): falling back to
   * the environment defaults is right for login, wrong for a drop — it would
   * apply a window the administrator never set.
   */
  async currentStrict(): Promise<PolicySettings> {
    return applyOverrides(this.defaults, await this.source.load(), this.logger);
  }
}

/**
 * Merges validated overrides over the defaults, **one key at a time**.
 *
 * Per-key rather than whole-object because these values come out of a
 * database that later migrations, manual edits and M24's own validation
 * bugs can all reach. One nonsensical column — a negative
 * `loginAttemptLimit` that locks out every user on their first attempt —
 * should cost that one setting, not the whole policy.
 */
function applyOverrides(
  defaults: PolicySettings,
  overrides: PolicyOverrides,
  logger: Logger,
): PolicySettings {
  // Built as a loose record and validated as a whole at the end.
  // Assigning through the union key directly is not expressible —
  // TypeScript widens the write target to `never` because it cannot see
  // that the key and the value are the same member of the union.
  const resolved: Record<string, unknown> = { ...defaults };

  for (const key of Object.keys(defaults) as Array<keyof PolicySettings>) {
    const candidate = overrides[key];
    if (candidate === undefined) continue;

    const parsed = policySchema.shape[key].safeParse(candidate);
    if (!parsed.success) {
      logger.warn(
        { setting: key, reason: parsed.error.issues[0]?.message },
        'Ignoring invalid platform policy override; keeping the environment default',
      );
      continue;
    }

    resolved[key] = parsed.data;
  }

  // Not a cast: every value came from `defaults` or passed that key's
  // own schema, so this re-parse is cheap and makes the return type
  // earned rather than asserted.
  return policySchema.parse(resolved);
}
