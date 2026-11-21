import { DashboardWidgetGrid as WidgetGrid } from '@/components/patterns';

import {
  getDashboardWidget,
  type DashboardOverviewState,
  type DashboardWidgetId,
} from '../model/widgets';

/**
 * The Doctor Overview's binding of the shared dashboard layout
 * (`components/patterns/dashboard/DashboardWidgetGrid`) — which explains why
 * it is a wrapping flex row and how it sizes compact, standard and wide
 * widgets. This binding adds only the doctor's catalogue and the one
 * Overview document every doctor widget reads (FE-10.4).
 */
interface DashboardWidgetGridProps {
  readonly activeIds: readonly DashboardWidgetId[];
  readonly onRemove: (id: DashboardWidgetId) => void;
  /** The page's one Overview query, handed to every widget (FE-10.4). */
  readonly overview: DashboardOverviewState;
}

export function DashboardWidgetGrid({ activeIds, onRemove, overview }: DashboardWidgetGridProps) {
  return (
    <WidgetGrid
      activeIds={activeIds}
      getWidget={getDashboardWidget}
      onRemove={onRemove}
      widgetProps={{ overview }}
    />
  );
}
