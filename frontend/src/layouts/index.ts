/**
 * App shell — FRONTEND_ARCHITECTURE.md §4.
 * Shell chrome is configured per role via NavigationConfig ("menu as
 * data"); features never render their own shell pieces.
 */
export { AppShell } from './AppShell';
// Shared navbar controls (Phase 19) — reused by the admin command bar so
// notifications and the account menu behave identically across roles.
export { AvatarMenu } from './Navbar/AvatarMenu';
export { NotificationButton } from './Navbar/NotificationButton';
// The light/dark pill: foot of the sidebar, and the sign-in screens.
export { ThemeSwitch, type ThemeSwitchProps } from './ThemeSwitch';
// Bypass-blocks affordance (WCAG 2.4.1) — every shell renders it first and
// tags its scroll container with MAIN_CONTENT_ID.
export { MAIN_CONTENT_ID, SkipToContent } from './SkipToContent';
// Announces the page a client-side navigation landed on. Both shells mount
// one — the doctor/admin AppShell and the auth branch's AuthLayout — because
// a document title that changes without a page load is not reliably read.
export { FeatureErrorBoundary } from './FeatureErrorBoundary';
export { RouteAnnouncer } from './RouteAnnouncer';
export { useRouteTitle, useTranslatedRouteTitle } from './useRouteTitle';
export {
  ShellBadgesContext,
  useShellBadges,
  type ShellBadgesValue,
  type ShellFeedItem,
} from './badge-context';
export {
  ShellSearchContext,
  useShellSearch,
  type ShellSearchResult,
  type ShellSearchValue,
} from './search-context';
export {
  adminNavigation,
  doctorNavigation,
  laboratoryNavigation,
  pharmacyNavigation,
  receptionNavigation,
  type NavigationConfig,
  type NavigationItem,
  type NavigationSection,
  type RouteHandle,
} from './navigation';
