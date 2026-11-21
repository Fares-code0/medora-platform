import { useState } from 'react';

import { CalendarOff, Trash2 } from 'lucide-react';

import { useToast } from '@/app/providers';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Badge, Button, ConfirmationDialog, Drawer } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import { useRemoveTimeOffMutation, useUpcomingTimeOffQuery } from '../api/useAppointmentsQuery';
import type { TimeOffBlock, TimeOffKind } from '../model/time-off-service';

/**
 * The doctor's upcoming time off (API §3.9), and the one thing to do with a
 * block once it is booked: cancel it. Blocking time was write-only before —
 * a block booked by mistake could not be seen or taken back from the client.
 *
 * Cancelling frees the time for bookings and nothing else. Appointments a
 * resolution already cancelled or moved stay that way, and the confirmation
 * says so, because a doctor undoing a block could reasonably expect the
 * patients to come back with it.
 */
export interface UpcomingTimeOffDrawerProps {
  open: boolean;
  onClose: () => void;
}

const KIND_LABEL: Readonly<Record<TimeOffKind, string>> = {
  vacation: 'Planned',
  'emergency-block': 'Emergency',
};

const span = (block: TimeOffBlock) =>
  `${formatDate(block.startsAt)} ${formatTime(block.startsAt)} – ${formatDate(block.endsAt)} ${formatTime(block.endsAt)}`;

export function UpcomingTimeOffDrawer({ open, onClose }: UpcomingTimeOffDrawerProps) {
  const { toast } = useToast();
  const query = useUpcomingTimeOffQuery({ enabled: open });
  const remove = useRemoveTimeOffMutation();
  const [pending, setPending] = useState<TimeOffBlock | null>(null);

  return (
    <>
      <Drawer open={open} onClose={onClose} title="Upcoming time off">
        {query.isPending ? (
          <Stack gap={3} aria-busy="true" aria-label="Loading time off">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </Stack>
        ) : query.isError ? (
          <ErrorState
            title="Couldn't load your time off"
            error={query.error}
            onRetry={() => void query.refetch()}
            headingLevel="h3"
          />
        ) : query.data.length === 0 ? (
          <EmptyState
            icon={CalendarOff}
            title="No upcoming time off"
            description="Blocks you book with “Block time off” appear here until they end."
            headingLevel="h3"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {query.data.map((block) => (
              <li
                key={block.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-text-primary tabular-nums">
                    {span(block)}
                  </p>
                  <Badge
                    variant={block.kind === 'emergency-block' ? 'warning' : 'info'}
                    className="mt-1"
                  >
                    {KIND_LABEL[block.kind]}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Trash2}
                  onClick={() => setPending(block)}
                  aria-label={`Cancel time off ${span(block)}`}
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      <ConfirmationDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const block = pending;
          if (block === null) return;
          remove.mutate(block.id, {
            onSuccess: () => {
              setPending(null);
              toast({ variant: 'success', title: 'Time off cancelled' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't cancel the time off" }),
          });
        }}
        title="Cancel this time off?"
        description={`${
          pending === null ? '' : span(pending)
        } becomes bookable again. Appointments already cancelled or moved for it stay as they are.`}
        confirmLabel="Cancel time off"
        cancelLabel="Keep it"
        tone="destructive"
        loading={remove.isPending}
      />
    </>
  );
}
