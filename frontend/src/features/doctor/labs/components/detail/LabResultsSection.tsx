import { LineChart } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { StatusBadge } from '@/components/patterns';
import { Button } from '@/components/ui';
import { useT } from '@/i18n';

import { hasPreliminaryResults } from '../../model/review';
import {
  LAB_RESULT_FLAG_META,
  isCriticalFlag,
  type LabResultItem,
  type LabTest,
} from '../../model/types';

import { EmptySectionNote, LabSectionCard } from './LabSectionCard';

/**
 * Test results — the per-analyte table with value, unit, reference range,
 * and flag. Critical flags surface both as a non-dismissible banner at
 * the top of the section (never color-alone) and as red flag badges on
 * the affected rows.
 *
 * **D-13 put "View trend" on the row, not on the section.** UX §2.6 says
 * "from any analyte" — a single button above the table would make the doctor
 * open the drawer and then find the analyte again, which is the step the
 * per-row control removes. Only numeric analytes get one: a qualitative
 * result ("No growth") has nothing to plot.
 */

function ResultRow({
  result,
  onViewTrend,
}: {
  result: LabResultItem;
  onViewTrend: ((analyte: string) => void) | undefined;
}) {
  const t = useT();
  const meta = LAB_RESULT_FLAG_META[result.flag];
  const emphasize = result.flag !== 'normal';
  const trendable = onViewTrend !== undefined && result.numericValue !== null;
  return (
    <tr className="border-b border-border last:border-b-0">
      <th scope="row" className="py-2.5 pe-4 text-start align-top font-medium text-text-primary">
        {result.analyte}
      </th>
      {/* The value and its unit, and the range and its unit, are each one
          Latin-only run, pinned LTR: on an RTL page "0.5 10³/µL" otherwise
          reads "µL/0.510³" and "12.0–17.0 g/dL" reads "17.0g/dL –12.0"
          (NEW-32, `docs/handoff/i18n.md` §5). */}
      <td className="py-2.5 pe-4 align-top tabular-nums">
        <span dir="ltr">
          <span className={emphasize ? 'font-semibold text-text-primary' : 'text-text-primary'}>
            {result.value}
          </span>
          {result.unit ? <span className="ms-1 text-text-tertiary">{result.unit}</span> : null}
        </span>
      </td>
      <td className="py-2.5 pe-4 align-top tabular-nums text-text-secondary">
        <span dir="ltr">
          {result.referenceRange.text}
          {result.referenceRange.low !== null && result.unit ? (
            <span className="ms-1 text-text-tertiary">{result.unit}</span>
          ) : null}
        </span>
      </td>
      <td className="py-2.5 pe-4 align-top">
        {result.flag === 'normal' ? (
          <span className="text-text-tertiary">{meta.abbr}</span>
        ) : (
          <StatusBadge status={meta.kind} label={t(meta.labelKey)} />
        )}
      </td>
      <td className="py-2.5 align-top text-end">
        {trendable ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={LineChart}
            onClick={() => onViewTrend(result.analyte)}
            aria-label={`View the trend for ${result.analyte}`}
          >
            Trend
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

export function LabResultsSection({
  test,
  onViewTrend,
}: {
  test: LabTest;
  onViewTrend?: ((analyte: string) => void) | undefined;
}) {
  if (test.results.length === 0) {
    return (
      <LabSectionCard title="Test results">
        <EmptySectionNote>
          {test.status === 'cancelled'
            ? 'This order was cancelled before results were produced.'
            : 'Results are not yet available — this order is still in progress.'}
        </EmptySectionNote>
      </LabSectionCard>
    );
  }

  const criticalAnalytes = test.results.filter((result) => isCriticalFlag(result.flag));
  // Entered while the order is processing, not yet released (API §8.6).
  const preliminary = hasPreliminaryResults(test);

  return (
    <LabSectionCard
      title="Test results"
      caption={
        preliminary
          ? 'Preliminary values, not yet released by the laboratory.'
          : 'Values shown against their reference ranges.'
      }
    >
      {preliminary ? (
        <Alert variant="warning" title="Preliminary results">
          The laboratory has entered these values but not released them. They may still change, and
          they are not in the review queue until the order is completed.
        </Alert>
      ) : null}

      {criticalAnalytes.length > 0 ? (
        <Alert
          variant="error"
          critical
          title={`Critical result${criticalAnalytes.length === 1 ? '' : 's'}: ${criticalAnalytes
            .map(
              (result) =>
                `${result.analyte} ${result.value}${result.unit ? ` ${result.unit}` : ''}`,
            )
            .join(' · ')}`}
        >
          {preliminary
            ? 'Not yet released — the ordering team is notified when the laboratory releases it. Verify and correlate clinically before acting.'
            : 'Flagged to the ordering team — verify and correlate clinically before acting.'}
        </Alert>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-body-sm">
          <caption className="sr-only">
            Laboratory results for {test.testName} with reference ranges and flags
          </caption>
          <thead>
            <tr className="border-b border-border text-caption font-semibold uppercase tracking-wider text-text-tertiary">
              <th scope="col" className="py-2 pe-4 text-start">
                Analyte
              </th>
              <th scope="col" className="py-2 pe-4 text-start">
                Result
              </th>
              <th scope="col" className="py-2 pe-4 text-start">
                Reference range
              </th>
              <th scope="col" className="py-2 pe-4 text-start">
                Flag
              </th>
              <th scope="col" className="py-2 text-end">
                <span className="sr-only">Trend</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {test.results.map((result) => (
              <ResultRow key={result.id} result={result} onViewTrend={onViewTrend} />
            ))}
          </tbody>
        </table>
      </div>
    </LabSectionCard>
  );
}
