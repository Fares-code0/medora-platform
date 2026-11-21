/**
 * Doctor settings feature — PUBLIC API (FRONTEND_ARCHITECTURE.md §3.4).
 * Only the route config leaves the feature; sections, components, model,
 * and the mock service stay private. Appearance/accessibility preferences
 * are owned by the platform InterfaceSettingsProvider, and notification
 * preferences are reused from the notifications feature. Phase 19: the
 * Settings Center PAGE is additionally shared with the admin
 * Administration Center ("My Settings" parity) via a direct lazy import
 * of `./pages/SettingsPage` — deliberately NOT re-exported here, because
 * this index is imported eagerly by the root redirect and a static
 * re-export would drag the whole settings surface (and its zod schemas)
 * into the entry chunk.
 */
export { settingsRoutes } from './routes';
export { getDoctorLandingPath } from './landing';
