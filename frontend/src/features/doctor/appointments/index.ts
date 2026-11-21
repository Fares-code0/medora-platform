/**
 * Doctor appointments feature — PUBLIC API (FRONTEND_ARCHITECTURE §3.4).
 * Only the route config is exported; pages, components, model, and mock
 * data are internal to the feature.
 */
import { lazy } from 'react';

export { appointmentsRoutes } from './routes';

/**
 * The weekly-hours editor (DEC-005), mounted by the doctor's Settings —
 * **lazily** (NEW-21). The app router imports this barrel for the routes, so
 * a static re-export here put the appointments service, both adapters and
 * their seeded data into the entry chunk of every page, though only one
 * Settings section uses them. Render it inside a `Suspense` boundary.
 */
export const AvailabilitySection = lazy(() =>
  import('./components/availability/AvailabilitySection').then((module) => ({
    default: module.AvailabilitySection,
  })),
);
