/**
 * Health contract (API §20.1).
 *
 * ```json
 * { "data": { "status": "ok",
 *             "services": { "db": "unconfigured", "redis": "unconfigured",
 *                           "storage": "unconfigured", "mail": "unconfigured",
 *                           "ai": "unconfigured" } } }
 * ```
 *
 * The five service keys come from the API contract, which lists `ai`
 * alongside the four in RM M1.4. The contract governs response shape, so
 * all five are served.
 *
 * This feeds the admin System Health card (API §18.15), so the shape is
 * fixed now even though the probes behind it arrive later: the database
 * at M4, storage at M25, Redis at M31, mail with M19's channel workers.
 * Until then each reports `unconfigured` — deliberately distinct from
 * `down`, because "not wired yet" and "wired and failing" must not look
 * the same on an operations dashboard.
 */

export const SERVICE_KEYS = ['db', 'redis', 'storage', 'mail', 'ai'] as const;

export type ServiceKey = (typeof SERVICE_KEYS)[number];

export type ServiceStatus = 'up' | 'down' | 'unconfigured';

export type OverallStatus = 'ok' | 'degraded';

export interface HealthReport {
  readonly status: OverallStatus;
  readonly services: Readonly<Record<ServiceKey, ServiceStatus>>;
}

/**
 * Implemented once per dependency. A milestone that adds a dependency
 * adds its indicator here rather than editing the controller, so the
 * health surface never drifts from what the app actually depends on.
 */
export interface HealthIndicator {
  readonly key: ServiceKey;
  check(): Promise<ServiceStatus>;
}

/** DI token for the indicator array. */
export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');
