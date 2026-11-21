import { CustomizeDashboardDrawer as Drawer } from '@/components/patterns';

import {
  DASHBOARD_WIDGET_GROUPS,
  DASHBOARD_WIDGETS,
  type DashboardWidgetId,
} from '../model/widgets';

/**
 * Customize, over the doctor's catalogue. The drawer itself — one checkbox
 * per widget over a draft, applied only on Done — is the shared one
 * (`components/patterns/dashboard/CustomizeDashboardDrawer`), which records
 * why it is built that way.
 */
interface CustomizeDashboardDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDone: () => void;
  readonly isActive: (id: DashboardWidgetId) => boolean;
  readonly activeCount: number;
  readonly onToggle: (id: DashboardWidgetId, active: boolean) => void;
  readonly onClear: () => void;
}

export function CustomizeDashboardDrawer(props: CustomizeDashboardDrawerProps) {
  return <Drawer {...props} widgets={DASHBOARD_WIDGETS} groups={DASHBOARD_WIDGET_GROUPS} />;
}
