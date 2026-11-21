import { useMemo, useState } from 'react';

import {
  AlertTriangle,
  ArrowDown,
  ArrowRightCircle,
  ArrowUp,
  Flag,
  ListOrdered,
  Timer,
  X,
} from 'lucide-react';

import { useAuth, useToast } from '@/app/providers';
import { StatisticCard } from '@/components/patterns';
import { Badge, Button, ConfirmationDialog, Select } from '@/components/ui';
import { cn } from '@/utils/cn';

import {
  QUEUE_PRIORITY_LABEL,
  QUEUE_PRIORITY_VARIANT,
  formatMinutes,
} from '../administration.meta';
import type { QueueEntry, QueuePriority } from '../administration.types';
import { useQueue, useQueueMutations } from '../api/useAdministrationQueries';
import { AsyncSection, Overline, Panel } from '../components/primitives';
import { SectionShell } from '../components/SectionShell';
import { MaskedIdentifier } from '../phi';

/**
 * QueueSection — live patient queue (Phase 17; made operable in Phase B).
 * Highlights the next patient, surfaces delayed and priority cases, and shows
 * per-patient estimated waiting time.
 *
 * Until Phase B this was a queue you could only watch: no way to call the
 * next patient, reprioritise, reorder, or remove anyone. All four are here
 * now, and every change persists.
 */
const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'priority', label: 'Priority' },
  { value: 'routine', label: 'Routine' },
] as const;

const PRIORITY_FIELD_OPTIONS = PRIORITY_OPTIONS.filter((o) => o.value !== 'all').map((o) => ({
  value: o.value,
  label: o.label,
}));

export function QueueSection() {
  const queue = useQueue();
  const { update, remove, replace } = useQueueMutations();
  const { toast } = useToast();
  // The server's write endpoints are administrator-only; reception reads the
  // board but is shown no control the server would refuse.
  const canOperate = useAuth().user?.role === 'admin';
  const [priority, setPriority] = useState('all');
  const [pendingRemove, setPendingRemove] = useState<QueueEntry | null>(null);

  const all = useMemo(() => queue.data ?? [], [queue.data]);
  const next = all[0];
  const avgWait = useMemo(() => {
    if (all.length === 0) return 0;
    return Math.round(all.reduce((sum, e) => sum + e.waitingMinutes, 0) / all.length);
  }, [all]);
  const delayedCount = all.filter((e) => e.delayed).length;
  const priorityCount = all.filter((e) => e.priority !== 'routine').length;

  const rows = useMemo(
    () => all.filter((entry) => priority === 'all' || entry.priority === priority),
    [all, priority],
  );

  /** Moves an entry one place up or down and persists the new order. */
  const move = (entry: QueueEntry, delta: -1 | 1) => {
    const index = all.findIndex((item) => item.id === entry.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= all.length) return;
    const next = [...all];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    replace.mutate(next);
  };

  const callNext = () => {
    if (!next) return;
    remove.mutate(next.id, {
      onSuccess: () =>
        toast({
          variant: 'success',
          title: 'Called ' + next.ticket,
          // The ticket, not the name: a toast is a shared-screen surface.
          description: next.ticket + ' — ' + next.reason,
        }),
      onError: () => toast({ variant: 'error', title: "Couldn't call " + next.ticket }),
    });
  };

  return (
    <SectionShell
      slug="queue"
      actions={
        canOperate ? (
          <Button leadingIcon={ArrowRightCircle} onClick={callNext} disabled={!next}>
            Call next patient
          </Button>
        ) : undefined
      }
      toolbar={
        <Select
          options={PRIORITY_OPTIONS}
          value={priority}
          onChange={setPriority}
          aria-label="Filter by priority"
          containerClassName="sm:w-48"
        />
      }
    >
      <AsyncSection
        isLoading={queue.isLoading}
        isError={queue.isError}
        onRetry={() => void queue.refetch()}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline" label="In queue" value={all.length} icon={ListOrdered} tone="primary" />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline" label="Avg. wait" value={avgWait} unit="min" icon={Timer} tone="info" />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline" label="Delayed" value={delayedCount} icon={AlertTriangle} tone="error" />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline" label="Priority" value={priorityCount} icon={Flag} tone="warning" />
          </div>

          {next ? (
            <Panel title="Next patient" icon={ArrowRightCircle} tone="success">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <span className="inline-flex h-12 min-w-12 items-center justify-center rounded-surface bg-primary text-body font-bold text-text-inverse tabular-nums">
                    {next.ticket}
                  </span>
                  <div>
                    <div className="text-h5 font-semibold text-text-primary">
                      <MaskedIdentifier
                        subjectId={next.id}
                        subjectLabel={`Queue ticket ${next.ticket}`}
                        kind="name"
                        value={next.patientName}
                      />
                    </div>
                    <div className="text-body-sm text-text-secondary">{next.reason}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={QUEUE_PRIORITY_VARIANT[next.priority]} dot>
                    {QUEUE_PRIORITY_LABEL[next.priority]}
                  </Badge>
                  <div className="text-end">
                    <Overline>Waiting</Overline>
                    <div className="text-body font-semibold text-text-primary tabular-nums">
                      {formatMinutes(next.waitingMinutes)}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel title="Queue" icon={ListOrdered} tone="info" bodyClassName="p-0">
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-body-sm text-text-secondary">
                No patients match this priority.
              </p>
            ) : (
              <ul className="flex flex-col">
                {rows.map((entry, index) => (
                  <QueueRow
                    key={entry.id}
                    entry={entry}
                    isFirst={index === 0}
                    isLast={index === rows.length - 1}
                    readOnly={!canOperate}
                    onPriority={(value) => {
                      update.mutate({ id: entry.id, changes: { priority: value } });
                    }}
                    onMoveUp={() => move(entry, -1)}
                    onMoveDown={() => move(entry, 1)}
                    onRemove={() => setPendingRemove(entry)}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </AsyncSection>

      <ConfirmationDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => {
          const entry = pendingRemove;
          if (!entry) return;
          remove.mutate(entry.id, {
            onSuccess: () => {
              setPendingRemove(null);
              toast({ variant: 'success', title: entry.ticket + ' removed from the queue' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't remove " + entry.ticket }),
          });
        }}
        title={'Remove ' + (pendingRemove?.ticket ?? 'this ticket') + ' from the queue?'}
        description="They keep their appointment; only their place in today's queue is cleared."
        confirmLabel="Remove from queue"
        tone="destructive"
        loading={remove.isPending}
      />
    </SectionShell>
  );
}

interface QueueRowProps {
  entry: QueueEntry;
  isFirst: boolean;
  isLast: boolean;
  readOnly: boolean;
  onPriority: (value: QueuePriority) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

function QueueRow({
  entry,
  isFirst,
  isLast,
  readOnly,
  onPriority,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QueueRowProps) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0',
        entry.delayed && 'bg-error-subtle',
      )}
    >
      <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-surface bg-surface-sunken px-1.5 text-caption font-semibold text-text-secondary tabular-nums">
        {entry.ticket}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-sm font-medium text-text-primary">
          <MaskedIdentifier
            subjectId={entry.id}
            subjectLabel={`Queue ticket ${entry.ticket}`}
            kind="name"
            value={entry.patientName}
          />
        </div>
        <div className="truncate text-caption text-text-tertiary">{entry.reason}</div>
      </div>
      {entry.delayed ? (
        <Badge variant="error" icon={AlertTriangle}>
          Delayed
        </Badge>
      ) : null}
      {readOnly ? (
        <Badge variant={QUEUE_PRIORITY_VARIANT[entry.priority]} dot>
          {QUEUE_PRIORITY_LABEL[entry.priority]}
        </Badge>
      ) : (
        <Select
          options={PRIORITY_FIELD_OPTIONS}
          value={entry.priority}
          onChange={(value) => onPriority(value as QueuePriority)}
          aria-label={'Priority for ticket ' + entry.ticket}
          containerClassName="w-32"
        />
      )}
      <div className="hidden w-24 text-end sm:block">
        <Overline>Est. wait</Overline>
        <div className="text-body-sm font-medium text-text-primary tabular-nums">
          {formatMinutes(entry.estimatedMinutes)}
        </div>
      </div>
      {readOnly ? null : (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={ArrowUp}
            aria-label={'Move ticket ' + entry.ticket + ' up'}
            disabled={isFirst}
            onClick={onMoveUp}
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={ArrowDown}
            aria-label={'Move ticket ' + entry.ticket + ' down'}
            disabled={isLast}
            onClick={onMoveDown}
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={X}
            aria-label={'Remove ticket ' + entry.ticket + ' from the queue'}
            onClick={onRemove}
          />
        </div>
      )}
    </li>
  );
}
