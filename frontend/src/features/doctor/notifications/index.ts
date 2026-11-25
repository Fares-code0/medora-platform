/**
 * Doctor notifications feature — PUBLIC API (FRONTEND_ARCHITECTURE.md
 * §3.4). Besides the route config, this feature exports the badge/feed
 * queries and category metadata consumed by the app shell — the
 * `badgeSource` wiring the shell mock reserved for this phase (§4).
 * Pages, components, model internals, and the mock service stay private.
 */
export { notificationsRoutes } from './routes';
export {
  useNotificationBadgesQuery,
  useNotificationsListQuery,
  useRecentNotificationsQuery,
  useUpdateNotificationsMutation,
  useMarkAllNotificationsReadMutation,
  useArchiveAllReadMutation,
} from './api/useNotificationsQuery';
export { useNotificationPreferences } from './hooks/useNotificationPreferences';
export { notificationCapabilities } from './model/capabilities';
export {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_META,
  type DoctorNotification,
  type NotificationPreferences,
} from './model/types';
