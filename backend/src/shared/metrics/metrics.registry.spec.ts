import { describe, expect, it } from 'vitest';

import { LATENCY_BUCKETS, MetricsRegistry, renderJobMetrics } from './metrics.registry';

/** The exposition format (M38.1). The scrape endpoint is `test/metrics.e2e-spec.ts`. */
describe('MetricsRegistry', () => {
  it('counts requests by method, route and status class', () => {
    const registry = new MetricsRegistry();
    registry.observeHttp('GET', '/api/v1/health', 200, 0.002);
    registry.observeHttp('GET', '/api/v1/health', 204, 0.002);
    registry.observeHttp('GET', '/api/v1/health', 503, 0.002);

    const text = registry.render();

    expect(text).toContain(
      'medora_http_requests_total{method="GET",route="/api/v1/health",status_class="2xx"} 2',
    );
    expect(text).toContain(
      'medora_http_requests_total{method="GET",route="/api/v1/health",status_class="5xx"} 1',
    );
  });

  it('keeps cumulative histogram buckets, with +Inf, sum and count', () => {
    const registry = new MetricsRegistry();
    registry.observeHttp('POST', '/r', 201, 0.03);
    registry.observeHttp('POST', '/r', 201, 0.3);
    registry.observeHttp('POST', '/r', 201, 30);

    const text = registry.render();
    const bucket = (le: string): string | undefined =>
      new RegExp(
        `medora_http_request_duration_seconds_bucket\\{method="POST",route="/r",le="${le}"\\} (\\d+)`,
      ).exec(text)?.[1];

    expect(bucket('0.025')).toBe('0');
    expect(bucket('0.05')).toBe('1');
    expect(bucket('0.5')).toBe('2');
    expect(bucket(String(LATENCY_BUCKETS.at(-1)))).toBe('2');
    expect(bucket('\\+Inf')).toBe('3');
    expect(text).toContain(
      'medora_http_request_duration_seconds_count{method="POST",route="/r"} 3',
    );
    expect(text).toMatch(
      /medora_http_request_duration_seconds_sum\{method="POST",route="\/r"\} 30\.33/,
    );
  });

  it('escapes label values as the format requires', () => {
    const registry = new MetricsRegistry();
    registry.observeHttp('GET', 'a"b\\c\nd', 200, 0.001);

    expect(registry.render()).toContain('route="a\\"b\\\\c\\nd"');
  });

  it('declares every family it renders, and reports process gauges', () => {
    const text = new MetricsRegistry().render();

    for (const family of [
      'medora_http_requests_total counter',
      'medora_http_request_duration_seconds histogram',
      'medora_process_uptime_seconds gauge',
      'medora_process_resident_memory_bytes gauge',
      'medora_process_heap_used_bytes gauge',
    ]) {
      expect(text).toContain(`# TYPE ${family}`);
    }
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('renderJobMetrics', () => {
  it("renders each job's counters and its last duration in seconds", () => {
    const text = renderJobMetrics([
      {
        job: 'files.orphan-sweep',
        started: 3,
        succeeded: 2,
        failedAttempts: 1,
        deadLettered: 0,
        lastDurationMs: 1500,
      },
      {
        job: 'never.ran',
        started: 0,
        succeeded: 0,
        failedAttempts: 0,
        deadLettered: 0,
        lastDurationMs: null,
      },
    ]);

    expect(text).toContain('medora_job_runs_total{job="files.orphan-sweep",result="succeeded"} 2');
    expect(text).toContain(
      'medora_job_runs_total{job="files.orphan-sweep",result="failed_attempt"} 1',
    );
    expect(text).toContain('medora_job_last_duration_seconds{job="files.orphan-sweep"} 1.5');
    expect(text).not.toContain('medora_job_last_duration_seconds{job="never.ran"}');
  });
});
