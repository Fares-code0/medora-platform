import { Grid } from '@/components/layout';
import { KpiWidget } from '@/components/patterns';
import type { StatisticDelta, StatisticTone } from '@/components/patterns';

import { formatKpiValue } from '../model/selectors';
import type { KpiDatum, SemanticTone } from '../model/types';

/**
 * Executive KPI row — the six headline metrics (revenue, patients,
 * appointments, lab orders, prescriptions, growth) as sparkline cards.
 * Reuses the platform KpiWidget so the reports KPIs match the dashboard's
 * KPI language exactly; only the data source differs.
 */

/**
 * SemanticTone → StatisticTone (accent maps to the AI/accent chip).
 *
 * Keyed on `SemanticTone`, not `AnalyticsTone`: a KPI chip is a semantic UI
 * element, and the categorical chart slots have no meaning to express here.
 * Making that a type error is the point — it stops a chart colour leaking
 * into a KPI card, and a KPI colour from being chosen by list position.
 */
const KPI_TONE: Record<SemanticTone, StatisticTone> = {
  primary: 'primary',
  secondary: 'secondary',
  accent: 'ai',
  success: 'success',
  warning: 'warning',
  info: 'info',
  error: 'error',
};

function toDelta(percent: number): StatisticDelta {
  return {
    direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat',
    label: `${Math.abs(percent).toFixed(1)}%`,
    tone: percent > 0 ? 'positive' : percent < 0 ? 'negative' : 'neutral',
    comparison: 'vs previous period',
  };
}

export function KpiRow({ kpis, loading }: { kpis: readonly KpiDatum[]; loading?: boolean }) {
  if (loading) {
    return (
      <Grid preset="kpi" gap={4}>
        {Array.from({ length: 6 }, (_, i) => (
          <KpiWidget key={i} label="" value="" loading />
        ))}
      </Grid>
    );
  }

  return (
    <Grid preset="kpi" gap={4}>
      {kpis.map((kpi) => (
        <KpiWidget
          key={kpi.id}
          label={kpi.label}
          value={formatKpiValue(kpi)}
          icon={kpi.icon}
          tone={KPI_TONE[kpi.tone]}
          delta={toDelta(kpi.deltaPercent)}
          sparkline={kpi.spark}
        />
      ))}
    </Grid>
  );
}
