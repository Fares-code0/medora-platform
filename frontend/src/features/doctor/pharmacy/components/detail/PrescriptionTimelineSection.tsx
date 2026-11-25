import { Badge } from '@/components/ui';
import { useT } from '@/i18n';
import { formatDate, formatTime } from '@/utils/dates';

import { PRESCRIPTION_TIMELINE_META, type Prescription } from '../../model/types';

import { EmptySectionNote, PharmacySectionCard } from './PharmacySectionCard';

/**
 * Prescription timeline — reverse-chronological audit trail of the
 * prescription's lifecycle. Semantic <ol> with a token-styled spine; each
 * event carries its actor badge so the category is never icon-only.
 */
export function PrescriptionTimelineSection({ prescription }: { prescription: Prescription }) {
  const t = useT();
  const events = [...prescription.timeline].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <PharmacySectionCard title="Timeline">
      {events.length === 0 ? (
        <EmptySectionNote>No activity has been recorded yet.</EmptySectionNote>
      ) : (
        <ol className="relative flex flex-col gap-6 border-s border-border ps-6">
          {events.map((event) => {
            const meta = PRESCRIPTION_TIMELINE_META[event.kind];
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
                  <p className="text-body-sm font-semibold text-text-primary">{t(meta.labelKey)}</p>
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
    </PharmacySectionCard>
  );
}
