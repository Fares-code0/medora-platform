import { Injectable } from '@nestjs/common';

import type { AppEnv, Env } from './env.schema';
import { parseTrustProxy, type TrustProxySetting } from './trust-proxy';

/**
 * Typed access to the validated environment (RM M3.1).
 *
 * Injected wherever configuration is needed, so no module reads
 * `process.env` — that is what makes the contract in `env.schema.ts` a
 * contract rather than a suggestion, and it is enforced by the
 * `import/no-restricted-paths` zone that keeps modules out of this
 * folder's internals.
 *
 * The derived getters exist because the raw env is stringly-typed at the
 * edges: `CORS_ORIGINS` is one comma-separated string in the environment
 * and a list everywhere else, and parsing it at each call site is how
 * two call sites end up disagreeing about trailing whitespace.
 */
@Injectable()
export class ConfigService {
  constructor(readonly env: Env) {}

  get appEnv(): AppEnv {
    return this.env.APP_ENV;
  }

  get isProduction(): boolean {
    return this.env.APP_ENV === 'production';
  }

  get port(): number {
    return this.env.PORT;
  }

  /** Exact origins; blank entries dropped. Never a wildcard (ADR-011). */
  get corsOrigins(): readonly string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  /** The clamd daemon to scan uploads with (M25.3), or `null` when none is configured. */
  get clamav(): { readonly host: string; readonly port: number; readonly timeoutMs: number } | null {
    const host = this.env.CLAMAV_HOST;
    if (host === undefined) return null;

    return { host, port: this.env.CLAMAV_PORT, timeoutMs: this.env.CLAMAV_TIMEOUT_MS };
  }

  /** The broker's address. Read only by the job kernel's driver. */
  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  /**
   * Whether this instance fires its registered schedules (M30.1).
   *
   * Registration is unconditional — see `JobsBootstrap` — so a `false`
   * here means "another instance owns the sweeps", never "this build has
   * no jobs".
   */
  get jobsEnabled(): boolean {
    return this.env.JOBS_ENABLED;
  }

  /** Phase 22: compute and log the hospital-aware patient-scope shadow decision. */
  get hospitalScopeShadowComparison(): boolean {
    return this.env.HOSPITAL_SCOPE_SHADOW_COMPARISON;
  }

  /** Phase 22, C1: the shadow's in-flight cap and its transaction-local statement timeout. */
  get hospitalScopeShadowLimits(): {
    readonly maxInFlight: number;
    readonly statementTimeoutMs: number;
  } {
    return {
      maxInFlight: this.env.HOSPITAL_SCOPE_SHADOW_MAX_IN_FLIGHT,
      statementTimeoutMs: this.env.HOSPITAL_SCOPE_SHADOW_STATEMENT_TIMEOUT_MS,
    };
  }

  /** Express's `trust proxy` value; `false` unless the deployment names its proxies. */
  get trustProxy(): TrustProxySetting {
    const parsed = parseTrustProxy(this.env.TRUST_PROXY);
    // The schema has already refused an invalid value; this is unreachable.
    return typeof parsed === 'object' && 'error' in parsed ? false : parsed;
  }

  /** The per-client limit on the public credential routes (M37.2). */
  get rateLimit(): { readonly enabled: boolean; readonly max: number; readonly windowSeconds: number } {
    return {
      enabled: this.env.RATE_LIMIT_ENABLED,
      max: this.env.RATE_LIMIT_AUTH_MAX,
      windowSeconds: this.env.RATE_LIMIT_AUTH_WINDOW_SECONDS,
    };
  }

  /** The scrape token for `GET /metrics`; `undefined` means the endpoint is off (M38.1). */
  get metricsToken(): string | undefined {
    return this.env.METRICS_TOKEN;
  }

  /** `inline` timers or the BullMQ broker (M30.1). */
  get jobsDriver(): Env['JOBS_DRIVER'] {
    return this.env.JOBS_DRIVER;
  }

  /**
   * True once an AI provider is configured. `/health` reports
   * `ai: unconfigured` until then (ADR-016), and M16's gateway refuses
   * to start rather than calling an unset endpoint.
   */
  get isAiConfigured(): boolean {
    return (this.env.AI_PROVIDER ?? '').length > 0 && (this.env.AI_API_KEY ?? '').length > 0;
  }
}
