/**
 * Customizable dashboard — the pattern the Doctor and Admin Overviews share.
 * A role supplies its catalogue and its widgets' data; the layout, the
 * customize drawer, the empty state and the ⋯ menu are these.
 */
export {
  CustomizeDashboardDrawer,
  type CustomizeDashboardDrawerProps,
  type DashboardWidgetOption,
} from './CustomizeDashboardDrawer';
export {
  CustomizeDashboardButton,
  DashboardEmptyState,
  type DashboardEmptyStateProps,
} from './DashboardEmptyState';
export { DashboardGreeting, type DashboardGreetingProps } from './DashboardGreeting';
export { DashboardWidgetGrid, type DashboardWidgetGridProps } from './DashboardWidgetGrid';
export type {
  DashboardWidgetChrome,
  DashboardWidgetDefinition,
  DashboardWidgetGroupDefinition,
  DashboardWidgetSize,
  DashboardWidgetSource,
} from './types';
export { WidgetMenu, type WidgetMenuProps } from './WidgetMenu';
