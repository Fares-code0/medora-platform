/**
 * Public API — in-process metrics (M38.1).
 *
 * Modules import from `shared/metrics`, never from a file inside it.
 */
export { applyHttpMetrics } from './http-metrics';
export { MetricsKernelModule } from './metrics.module';
export {
  LATENCY_BUCKETS,
  MetricsRegistry,
  UNMATCHED_ROUTE,
  renderCacheMetrics,
  renderJobMetrics,
  type CacheCounterRow,
  type JobCounters,
} from './metrics.registry';
