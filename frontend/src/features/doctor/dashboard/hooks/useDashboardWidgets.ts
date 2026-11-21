import {
  useDashboardWidgetSelection,
  type DashboardWidgetSelection,
} from '@/hooks/useDashboardWidgetSelection';

import { isDashboardWidgetId, type DashboardWidgetId } from '../model/widgets';

/**
 * The doctor's widget selection: which widgets are on their Overview, in the
 * order they were added — empty until they choose, persisted per user under
 * `dashboardWidgets`. The behaviour (sanitising what is read back, per-user
 * namespacing, add/remove/restore/clear) is the shared
 * `useDashboardWidgetSelection`; this binds it to the doctor's catalogue.
 */
export type DashboardWidgetsState = DashboardWidgetSelection<DashboardWidgetId>;

export function useDashboardWidgets(): DashboardWidgetsState {
  return useDashboardWidgetSelection('dashboardWidgets', isDashboardWidgetId);
}
