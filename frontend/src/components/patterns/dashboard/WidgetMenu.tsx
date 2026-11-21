import { EllipsisVertical } from 'lucide-react';

import { Dropdown, type MenuEntry } from '@/components/ui/Dropdown';
import { IconButton } from '@/components/ui/IconButton';

/**
 * A dashboard widget's ⋯ overflow menu — the control every customizable
 * dashboard removes a widget through.
 *
 * It was inlined in `DashboardWidget`, which was fine while the Doctor
 * Overview was the only dashboard and every widget on it was a
 * `DashboardWidget`. The Admin Overview's widgets keep their own surfaces
 * (the area's `Panel` and the stacked `StatisticCard`), so the menu moved
 * here and each surface hosts the same one: one trigger, one label, one
 * keyboard behaviour on both dashboards.
 *
 * `title` names both the trigger and the menu ("Storage & usage options"), so
 * a screen reader hears which widget a ⋯ belongs to.
 */
export interface WidgetMenuProps {
  title: string;
  entries: readonly MenuEntry[];
}

export function WidgetMenu({ title, entries }: WidgetMenuProps) {
  return (
    <Dropdown
      trigger={<IconButton icon={EllipsisVertical} aria-label={`${title} options`} size="sm" />}
      entries={entries}
      menuLabel={`${title} options`}
    />
  );
}
