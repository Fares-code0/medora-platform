import { Activity, AlertTriangle, Clock, Download, MessagesSquare } from 'lucide-react';

import { useAuth } from '@/app/providers';
import { LineAreaChart } from '@/components/charts';
import { StatisticCard } from '@/components/patterns';
import { Button } from '@/components/ui';
import { exportCsv, type ExportDataset } from '@/utils/export';

import { Panel } from '../components/primitives';
import { logsApi } from '../logs/api/logs.api';

import type { CommunicationsOverview } from './communications.types';

/**
 * Overview tab (ADM-06B Task 7 · UX §3.6) — aggregates only.
 *
 * No excerpt, topic or participant name reaches this tab, in a label, a
 * tooltip or an empty state: it is an aggregates-only surface by design, the
 * same rule `communications.types.ts` states for the domain types
 * themselves. The trend below renders `overview.volume` verbatim — every
 * number here comes from `buildOverview` exactly once, never recomputed, so
 * this tab and the Safety Flags queue can never disagree about the same
 * fact.
 */
export function OverviewTab({ overview }: { overview: CommunicationsOverview }) {
  const { user } = useAuth();
  const flagRatePercent = `${(overview.flagRate * 100).toFixed(1)}%`;
  const totalVolume = overview.volume.points.reduce((sum, point) => sum + point.value, 0);

  const exportAggregates = () => {
    // Figure name and value, nothing else — no excerpt, no participant, no
    // raw series. `overview.volume`'s own timestamps and per-day counts stay
    // out of the file; only its 14-day total joins the other four scalars.
    const dataset: ExportDataset = {
      filename: 'medora-communications-overview',
      title: 'Communication monitoring — aggregates',
      columns: ['Figure', 'Value'],
      rows: [
        [
          'Median response time (minutes)',
          overview.medianResponseMinutes ?? 'No answered messages yet',
        ],
        ['Unanswered over 48h', overview.unansweredOver48h],
        ['Active conversations', overview.activeConversations],
        ['Flag rate', flagRatePercent],
        ['Messages, trailing 14 days', totalVolume],
      ],
    };
    /*
     * Logged before the file is written — the same ordering §3.7's own
     * export uses and for the same reason: an export that failed to log is
     * an export that did not happen. Built from `dataset` itself, not a
     * hand-counted "5", so the row count and the figure names in the log can
     * never drift from what the file actually contains — the gap a sibling
     * feature (ADM-07) shipped once, when a mutation exported 174 rows where
     * the log's own event still claimed 10.
     */
    logsApi.recordExport({
      target: `${dataset.filename}.csv`,
      actor: user?.name ?? 'Administrator',
      summary: `Exported ${String(dataset.rows.length)} communication monitoring aggregate figures: ${dataset.rows.map((row) => String(row[0])).join(', ')}`,
      payload: {
        format: 'csv',
        rowCount: dataset.rows.length,
      },
    });
    exportCsv(dataset);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Median response time"
          value={overview.medianResponseMinutes === null ? '—' : overview.medianResponseMinutes}
          unit={overview.medianResponseMinutes === null ? undefined : 'min'}
          icon={Clock}
          // A practice that has answered nothing and one that answers
          // instantly are different facts — never render this as 0.
          hint={overview.medianResponseMinutes === null ? 'no answered messages yet' : undefined}
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Unanswered > 48h"
          value={overview.unansweredOver48h}
          icon={AlertTriangle}
          tone={overview.unansweredOver48h > 0 ? 'warning' : 'success'}
          hint={overview.unansweredOver48h > 0 ? 'Waiting on a reply' : 'Nothing overdue'}
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Active conversations"
          value={overview.activeConversations}
          icon={Activity}
          hint="Neither archived nor overdue"
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Flag rate"
          value={flagRatePercent}
          icon={MessagesSquare}
          tone={overview.flagRate > 0 ? 'warning' : 'success'}
          hint="Share of conversations with a safety flag"
        />
      </div>

      <Panel
        title="Message volume"
        description="Messages per day, trailing 14 days."
        icon={MessagesSquare}
        action={
          <Button variant="secondary" size="sm" leadingIcon={Download} onClick={exportAggregates}>
            Export aggregates
          </Button>
        }
      >
        <LineAreaChart
          series={[overview.volume]}
          variant="area"
          ariaLabel="Message volume, trailing 14 days"
        />
      </Panel>
    </div>
  );
}
