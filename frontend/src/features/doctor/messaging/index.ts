/**
 * Doctor messaging feature — PUBLIC API (FRONTEND_ARCHITECTURE.md §3.4).
 * Besides the route config, this feature exports the unread-badge query
 * consumed by the app shell (`badgeSource: 'messages'`). Pages,
 * components, model internals, and the mock service stay private.
 */
export { messagingRoutes } from './routes';
export { useMessagingBadgeQuery } from './api/useMessagingQueries';
