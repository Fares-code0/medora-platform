/**
 * Administration area — public entry points.
 *
 * NOTE: consumers deep-import these modules rather than this barrel. Pulling
 * `adminRoutes` through here would also pull `useAdminSearchIndex`, and with
 * it the whole query/API layer, into the entry chunk (the Phase 19 lesson).
 * The barrel exists to document the feature's surface.
 */
export { adminRoutes } from './routes';
export { useAdminSearchIndex } from './useAdminSearchIndex';
