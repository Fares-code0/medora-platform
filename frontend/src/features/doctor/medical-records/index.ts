/**
 * Doctor medical-records feature — PUBLIC API (FRONTEND_ARCHITECTURE.md
 * §3.4). Pages, components, model, and mock data stay internal to the
 * feature; only the route config and the one narrow read D-14's
 * attach-to-record flow needs are exported.
 */
export { medicalRecordsRoutes } from './routes';
export {
  useAttachableRecordsQuery,
  type AttachableRecord,
} from './api/useAttachableRecordsQuery';
