import { Injectable } from '@nestjs/common';

/**
 * In-process metrics, rendered in the Prometheus text format (RM M38.1).
 *
 * The abstraction monitoring needs from the application: request counts
 * by route and status class, request latency as a histogram (so a
 * dashboard can compute percentiles), process gauges, and the job
 * kernel's counters. **No backend, dashboard or alert exists** — those are
 * a deployment's (`docs/EXTERNAL_INTEGRATIONS.md`). This is what one
 * would scrape.
 *
 * ## Per instance, by design
 *
 * Every number here is this process's since it started. Prometheus
 * scrapes each instance and aggregates; that is the model the format is
 * built for. It is also why `GET /administration/platform-status` (M23.6)
 * is still not served from these figures: an administrator's single
 * "API response time" would be one instance's answer presented as the
 * platform's.
 *
 * ## Labels never carry a request's own values
 *
 * `route` is the **matched pattern** (`/api/v1/patients/:id`), never the
 * path a client sent. A raw path would put identifiers — and a chart's
 * MRN is an identifier — into every scrape, and would grow one series
 * per patient. Unmatched requests share one `route` value.
 *
 * Written by hand rather than with a client library: three metric
 * families, one format, and no dependency to audit.
 */

/** Seconds. Spans a cached read to a slow export. */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

export const UNMATCHED_ROUTE = '<unmatched>';

interface Histogram {
  readonly buckets: number[];
  sum: number;
  count: number;
}

@Injectable()
export class MetricsRegistry {
  private readonly requests = new Map<string, number>();
  private readonly latency = new Map<string, Histogram>();

  observeHttp(method: string, route: string, status: number, durationSeconds: number): void {
    const statusClass = `${String(Math.floor(status / 100))}xx`;
    const requestKey = labels({ method, route, status_class: statusClass });
    this.requests.set(requestKey, (this.requests.get(requestKey) ?? 0) + 1);

    const latencyKey = labels({ method, route });
    let histogram = this.latency.get(latencyKey);
    if (histogram === undefined) {
      histogram = { buckets: LATENCY_BUCKETS.map(() => 0), sum: 0, count: 0 };
      this.latency.set(latencyKey, histogram);
    }
    LATENCY_BUCKETS.forEach((bound, index) => {
      if (durationSeconds <= bound) histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1;
    });
    histogram.sum += durationSeconds;
    histogram.count += 1;
  }

  /** HTTP and process metrics, in the Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];

    lines.push(
      '# HELP medora_http_requests_total HTTP requests served, by matched route and status class.',
      '# TYPE medora_http_requests_total counter',
    );
    for (const [key, value] of this.requests) {
      lines.push(`medora_http_requests_total{${key}} ${String(value)}`);
    }

    lines.push(
      '# HELP medora_http_request_duration_seconds HTTP request latency, by matched route.',
      '# TYPE medora_http_request_duration_seconds histogram',
    );
    for (const [key, histogram] of this.latency) {
      LATENCY_BUCKETS.forEach((bound, index) => {
        lines.push(
          `medora_http_request_duration_seconds_bucket{${key},le="${String(bound)}"} ${String(histogram.buckets[index] ?? 0)}`,
        );
      });
      lines.push(
        `medora_http_request_duration_seconds_bucket{${key},le="+Inf"} ${String(histogram.count)}`,
        `medora_http_request_duration_seconds_sum{${key}} ${String(histogram.sum)}`,
        `medora_http_request_duration_seconds_count{${key}} ${String(histogram.count)}`,
      );
    }

    const memory = process.memoryUsage();
    lines.push(
      '# HELP medora_process_uptime_seconds Seconds since this process started.',
      '# TYPE medora_process_uptime_seconds gauge',
      `medora_process_uptime_seconds ${String(process.uptime())}`,
      '# HELP medora_process_resident_memory_bytes Resident set size.',
      '# TYPE medora_process_resident_memory_bytes gauge',
      `medora_process_resident_memory_bytes ${String(memory.rss)}`,
      '# HELP medora_process_heap_used_bytes V8 heap in use.',
      '# TYPE medora_process_heap_used_bytes gauge',
      `medora_process_heap_used_bytes ${String(memory.heapUsed)}`,
    );

    return `${lines.join('\n')}\n`;
  }
}

/** The job kernel's counters (`JobMetricsService`), structurally. */
export interface JobCounters {
  readonly job: string;
  readonly started: number;
  readonly succeeded: number;
  readonly failedAttempts: number;
  readonly deadLettered: number;
  readonly lastDurationMs: number | null;
}

/** Job metrics in the same format, appended to `render()` by the endpoint. */
export function renderJobMetrics(jobs: readonly JobCounters[]): string {
  const lines = [
    '# HELP medora_job_runs_total Scheduled job runs on this instance, by result.',
    '# TYPE medora_job_runs_total counter',
  ];
  for (const job of jobs) {
    lines.push(
      `medora_job_runs_total{${labels({ job: job.job, result: 'started' })}} ${String(job.started)}`,
      `medora_job_runs_total{${labels({ job: job.job, result: 'succeeded' })}} ${String(job.succeeded)}`,
      `medora_job_runs_total{${labels({ job: job.job, result: 'failed_attempt' })}} ${String(job.failedAttempts)}`,
      `medora_job_runs_total{${labels({ job: job.job, result: 'dead_lettered' })}} ${String(job.deadLettered)}`,
    );
  }
  lines.push(
    "# HELP medora_job_last_duration_seconds Duration of the job's last run on this instance.",
    '# TYPE medora_job_last_duration_seconds gauge',
  );
  for (const job of jobs) {
    if (job.lastDurationMs === null) continue;
    lines.push(
      `medora_job_last_duration_seconds{${labels({ job: job.job })}} ${String(job.lastDurationMs / 1_000)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** The cache kernel's counters (`CacheService.metrics()`), structurally. */
export interface CacheCounterRow {
  readonly cache: string;
  readonly result: string;
  readonly count: number;
}

/**
 * Cache metrics in the same format (RM M31's exit gate: "hit-rate metric
 * visible"). The hit rate is `hit / (hit + miss)` per `cache`, in the
 * scraper. Labels are cache names and outcomes only — never a key or a
 * scope, which for the badge cache would be a user id.
 */
export function renderCacheMetrics(rows: readonly CacheCounterRow[]): string {
  const lines = [
    '# HELP medora_cache_requests_total Cache lookups on this instance, by cache and result.',
    '# TYPE medora_cache_requests_total counter',
    ...rows.map(
      (row) =>
        `medora_cache_requests_total{${labels({ cache: row.cache, result: row.result })}} ${String(row.count)}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** `a="1",b="2"`, with the format's three escapes. */
function labels(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(
      ([name, value]) =>
        `${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    )
    .join(',');
}
