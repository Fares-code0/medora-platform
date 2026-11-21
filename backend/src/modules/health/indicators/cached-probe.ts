import type { ServiceStatus } from '../health.types';

/**
 * How long a remote probe's answer is reused (ms).
 *
 * `/health` and `/ready` are polled by load balancers on every instance,
 * every few seconds. A probe that opens an SMTP session or signs an S3
 * request on each poll turns monitoring into load on the dependency it is
 * watching. Fifteen seconds is well inside any alerting window and caps a
 * relay at four probe connections a minute per instance.
 */
export const REMOTE_PROBE_TTL_MS = 15_000;

/**
 * Memoises a probe's status for a TTL, and shares the one in flight.
 *
 * Sharing matters as much as caching: with a slow relay, polls arriving
 * while a probe is pending would otherwise each open their own connection
 * and pile up behind it.
 */
export class CachedProbe {
  private cached: { readonly status: ServiceStatus; readonly at: number } | null = null;
  private inFlight: Promise<ServiceStatus> | null = null;

  constructor(
    private readonly probe: () => Promise<ServiceStatus>,
    private readonly ttlMs: number = REMOTE_PROBE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  check(): Promise<ServiceStatus> {
    if (this.cached !== null && this.now() - this.cached.at < this.ttlMs) {
      return Promise.resolve(this.cached.status);
    }

    this.inFlight ??= this.probe()
      .then((status) => {
        this.cached = { status, at: this.now() };
        return status;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }
}
