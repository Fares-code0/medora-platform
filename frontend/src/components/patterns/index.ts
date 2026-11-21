/**
 * Tier 2 pattern components — UX §1.4 / FRONTEND_ARCHITECTURE §8.1.
 * Know UX patterns, not domains; receive config/data as props.
 */
export { DashboardWidget, type DashboardWidgetProps } from './DashboardWidget';
export {
  CustomizeDashboardButton,
  CustomizeDashboardDrawer,
  DashboardEmptyState,
  DashboardGreeting,
  DashboardWidgetGrid,
  WidgetMenu,
  type CustomizeDashboardDrawerProps,
  type DashboardEmptyStateProps,
  type DashboardGreetingProps,
  type DashboardWidgetChrome,
  type DashboardWidgetDefinition,
  type DashboardWidgetGridProps,
  type DashboardWidgetGroupDefinition,
  type DashboardWidgetOption,
  type DashboardWidgetSize,
  type DashboardWidgetSource,
  type WidgetMenuProps,
} from './dashboard';
export { ExportButton, type ExportButtonProps } from './ExportButton';
export { Fact, FactGrid } from './FactList';
export { FlowStepper, type FlowStep, type FlowStepperProps } from './FlowStepper';
export { FilterBar, type ActiveFilter, type FilterBarProps } from './FilterBar';
export { KpiWidget, Sparkline, type KpiWidgetProps } from './KpiWidget';
export { MarkdownContent } from './RichText';
export { RichTextField, type RichTextFieldProps } from './RichTextField';
export { MetricStrip, type MetricStripItem, type MetricStripProps } from './MetricStrip';
export { PasswordStrengthMeter, type PasswordStrengthMeterProps } from './PasswordStrengthMeter';
export { ProfilePhotoField, type ProfilePhotoFieldProps } from './ProfilePhotoField';
export { Reveal, type RevealProps } from './Reveal';
export { SearchBar, type SearchBarProps } from './SearchBar';
export { Stagger, type StaggerItem, type StaggerProps } from './Stagger';
export { TagListField, type TagListFieldProps } from './TagListField';
export {
  StatisticCard,
  type StatisticCardProps,
  type StatisticDelta,
  type StatisticTone,
} from './StatisticCard';
export {
  StatusBadge,
  STATUS_PRESENTATION,
  STATUS_VARIANTS,
  type StatusBadgeProps,
  type StatusKind,
  type StatusPresentation,
} from './StatusBadge';
