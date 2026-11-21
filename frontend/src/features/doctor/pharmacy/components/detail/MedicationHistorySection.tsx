import { formatDate } from '@/utils/dates';

import type { Prescription } from '../../model/types';

import { EmptySectionNote, PharmacySectionCard } from './PharmacySectionCard';

/**
 * Medication history — prior courses and changes for this medication,
 * most recent first. A concise adherence/continuity view distinct from
 * the lifecycle timeline of the current prescription.
 */
export function MedicationHistorySection({ prescription }: { prescription: Prescription }) {
  const entries = [...prescription.history].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <PharmacySectionCard title="Medication history">
      {entries.length === 0 ? (
        <EmptySectionNote>No prior history is recorded for this medication.</EmptySectionNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-text-primary">{entry.event}</p>
                <p className="mt-0.5 text-body-sm text-text-secondary">{entry.detail}</p>
              </div>
              <p className="shrink-0 text-caption text-text-tertiary tabular-nums">
                {formatDate(entry.date)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PharmacySectionCard>
  );
}
