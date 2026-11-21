import { LineAreaChart } from '@/components/charts';
import type { NamedSeries } from '@/components/charts';
import { DashboardWidget } from '@/components/patterns';
import type { MenuEntry } from '@/components/ui';

import { NoSourceYet } from './NoSourceYet';

/**
 * Appointments trend — the UX 2.1 Row 3 P6 chart slot: completed vs
 * cancelled appointments per day over the last 14 days, on the shared
 * token-styled area chart (interactive legend, native tooltips).
 */
export function AppointmentsTrendWidget({
  series,
  loading = false,
  error,
  menu,
  className,
}: {
  /** Null when the source has no appointment history series to give. */
  series: readonly NamedSeries[] | null;
  loading?: boolean;
  error?: { readonly onRetry?: () => void } | undefined;
  /** The widget's ⋯ menu, from the Overview's widget grid. */
  menu?: readonly MenuEntry[] | undefined;
  className?: string | undefined;
}) {
  return (
    <DashboardWidget
      title="Appointments trend"
      subtitle="Completed vs cancelled · last 14 days"
      menu={menu}
      className={className}
      loading={loading}
      error={error}
      empty={series === null ? <NoSourceYet what="an appointments trend" /> : undefined}
    >
      <LineAreaChart
        series={series ?? []}
        variant="area"
        ariaLabel="Completed versus cancelled appointments per day over the last 14 days"
      />
    </DashboardWidget>
  );
}
