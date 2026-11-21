/**
 * Doctor laboratory feature — PUBLIC API (FRONTEND_ARCHITECTURE.md §3.4).
 * The route config, plus the read-only test catalogue the app layer mounts in
 * the laboratory workspace (DEC-006a); pages, components, model, and mock data
 * are otherwise internal to the feature.
 */
export { labsRoutes } from './routes';
/**
 * Loads the read-only test catalogue for the laboratory workspace's route
 * `lazy` (DEC-006a). A loader rather than a static re-export (NEW-21): the
 * router imports this barrel for `labsRoutes`, so re-exporting the page put
 * the lab service, the review and ordering models and the lab-studies corpus
 * into the entry chunk of every page.
 */
export const loadLabCataloguePage = () =>
  import('./pages/LabCataloguePage').then((module) => module.LabCataloguePage);
