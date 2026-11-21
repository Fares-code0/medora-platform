import { Plus, Trash2 } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Badge, Button, IconButton } from '@/components/ui';
import { formatDate, relativeDayLabel } from '@/utils/dates';

import { HISTORY_KIND_META, type MedicalHistoryEvent } from '../../model/profile-types';

/**
 * Medical history — reverse-chronological timeline of diagnoses,
 * surgeries, procedures, hospitalizations, and vaccinations. Semantic
 * <ol> with a token-styled spine; each event carries its kind badge so
 * the category is never icon-only. An event added in error can be removed
 * with a reason (DEC-003); there is no edit, because the API has no
 * correction route (BR-DEC-003 point 1).
 */
export function HistoryTab({
  events,
  onAdd,
  onRemove,
}: {
  events: readonly MedicalHistoryEvent[];
  /** Opens the add-event dialog; the button is absent without it. */
  onAdd?: (() => void) | undefined;
  /** Opens the removal dialog for one event; the per-event button is absent without it. */
  onRemove?: ((event: MedicalHistoryEvent) => void) | undefined;
}) {
  return (
    <Stack gap={4}>
      {onAdd !== undefined ? (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAdd}>
            Add event
          </Button>
        </div>
      ) : null}
      {events.length === 0 ? (
        <EmptyState
          title="No medical history recorded"
          description="Diagnoses, surgeries, and vaccinations will appear here as they are documented."
        />
      ) : (
        <Timeline events={events} onRemove={onRemove} />
      )}
    </Stack>
  );
}

function Timeline({
  events,
  onRemove,
}: {
  events: readonly MedicalHistoryEvent[];
  onRemove: ((event: MedicalHistoryEvent) => void) | undefined;
}) {
  return (
    <ol className="relative flex flex-col gap-6 border-s border-border ps-6">
      {events.map((event) => {
        const meta = HISTORY_KIND_META[event.kind];
        const Icon = meta.icon;
        return (
          <li key={event.id} className="relative">
            <span
              aria-hidden="true"
              className="absolute -start-[37px] flex h-6 w-6 items-center justify-center rounded-pill border border-border bg-surface text-text-secondary"
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <p className="text-body-sm font-semibold text-text-primary">{event.title}</p>
                <Badge variant="neutral">{meta.label}</Badge>
              </div>
              {onRemove === undefined ? null : (
                <IconButton
                  icon={Trash2}
                  size="sm"
                  aria-label={`Remove history event: ${event.title}`}
                  onClick={() => onRemove(event)}
                />
              )}
            </div>
            <p className="mt-0.5 text-caption text-text-tertiary tabular-nums">
              {formatDate(event.date)} · {relativeDayLabel(event.date)}
              {event.facility ? ` · ${event.facility}` : ''}
            </p>
            {event.detail === '' ? null : (
              <p className="mt-1 text-body-sm text-text-secondary">{event.detail}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
