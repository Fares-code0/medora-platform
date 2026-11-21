import { Badge } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import { RECORD_TIMELINE_META, type MedicalRecord } from '../../model/types';

import { EmptySectionNote, RecordSectionCard } from './RecordSectionCard';

/**
 * Record timeline — reverse-chronological audit trail of the record's
 * lifecycle. Semantic <ol> with a token-styled spine; each event carries
 * its kind badge so the category is never icon-only.
 */
export function RecordTimelineSection({ record }: { record: MedicalRecord }) {
  const events = [...record.timeline].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <RecordSectionCard title="Timeline">
      {events.length === 0 ? (
        <EmptySectionNote>No activity has been recorded yet.</EmptySectionNote>
      ) : (
        <ol className="relative flex flex-col gap-6 border-s border-border ps-6">
          {events.map((event) => {
            const meta = RECORD_TIMELINE_META[event.kind];
            const Icon = meta.icon;
            return (
              <li key={event.id} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -start-[37px] flex h-6 w-6 items-center justify-center rounded-pill border border-border bg-surface text-text-secondary"
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body-sm font-semibold text-text-primary">{meta.label}</p>
                  <Badge variant="neutral">{event.actor}</Badge>
                </div>
                <p className="mt-0.5 text-caption text-text-tertiary tabular-nums">
                  {formatDate(event.at)} · {formatTime(event.at)}
                </p>
                <p className="mt-1 text-body-sm text-text-secondary">{event.detail}</p>
              </li>
            );
          })}
        </ol>
      )}
    </RecordSectionCard>
  );
}
