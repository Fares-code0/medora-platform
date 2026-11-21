import { Smile } from 'lucide-react';

import { PieChart } from '@/components/charts';
import type { Slice } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { DashboardWidget } from '@/components/patterns';
import type { MenuEntry } from '@/components/ui';

import { NoSourceYet } from './NoSourceYet';

/**
 * Patient satisfaction — post-visit survey ratings for the current month as
 * a donut on the shared token-styled pie chart, with the response total in
 * the hole and a click-to-filter legend.
 */
export function SatisfactionWidget({
  slices,
  loading = false,
  error,
  menu,
  className,
}: {
  /** Null when the source has no survey results to give; empty for a month with none. */
  slices: readonly Slice[] | null;
  loading?: boolean;
  error?: { readonly onRetry?: () => void } | undefined;
  /** The widget's ⋯ menu, from the Overview's widget grid. */
  menu?: readonly MenuEntry[] | undefined;
  className?: string | undefined;
}) {
  return (
    <DashboardWidget
      title="Patient satisfaction"
      subtitle="Post-visit surveys · this month"
      menu={menu}
      className={className}
      loading={loading}
      error={error}
      empty={
        slices === null ? (
          <NoSourceYet what="patient satisfaction surveys" />
        ) : slices.length === 0 ? (
          <EmptyState
            icon={Smile}
            title="No responses this month"
            description="Survey ratings appear here once patients answer them."
          />
        ) : undefined
      }
    >
      <PieChart
        slices={slices ?? []}
        variant="donut"
        centerLabel="Responses"
        ariaLabel="Patient satisfaction survey results for this month"
      />
    </DashboardWidget>
  );
}
