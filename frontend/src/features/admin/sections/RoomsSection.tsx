import { useMemo, useState } from 'react';

import { DoorOpen } from 'lucide-react';

import { useToast } from '@/app/providers';
import { StatusBadge } from '@/components/patterns';
import {Select} from '@/components/ui';

import { ROOM_STATUS_KIND, ROOM_STATUS_LABEL } from '../administration.meta';
import type { RoomKind, RoomStatus } from '../administration.types';
import { useRooms, useRoomMutations } from '../api/useAdministrationQueries';
import { AsyncSection, Overline } from '../components/primitives';
import { SectionShell } from '../components/SectionShell';

/**
 * RoomsSection — clinic room board (Phase 17).
 * A status-coloured tile board covering consultation, lab, procedure,
 * pharmacy and waiting spaces, with kind and status filters and a live
 * status tally across the top.
 */
const KIND_LABEL: Record<RoomKind, string> = {
  consultation: 'Consultation',
  lab: 'Lab',
  procedure: 'Procedure',
  pharmacy: 'Pharmacy',
  waiting: 'Waiting area',
};

const KIND_OPTIONS = [
  { value: 'all', label: 'All room types' },
  { value: 'consultation', label: 'Consultation' },
  { value: 'lab', label: 'Lab' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'waiting', label: 'Waiting area' },
] as const;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'available', label: 'Available' },
  { value: 'occupied', label: 'Occupied' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'maintenance', label: 'Maintenance' },
] as const;

/** Status choices for the per-room control (the filter's "all" removed). */
const STATUS_FIELD_OPTIONS = STATUS_OPTIONS.filter((o) => o.value !== 'all').map((o) => ({
  value: o.value,
  label: o.label,
}));

export function RoomsSection() {
  const rooms = useRooms();
  const { update } = useRoomMutations();
  const { toast } = useToast();
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');

  const tally = useMemo(() => {
    const counts: Record<RoomStatus, number> = {
      available: 0,
      occupied: 0,
      cleaning: 0,
      maintenance: 0,
    };
    for (const room of rooms.data ?? []) counts[room.status] += 1;
    return counts;
  }, [rooms.data]);

  const rows = useMemo(
    () =>
      (rooms.data ?? []).filter((room) => {
        if (kind !== 'all' && room.kind !== kind) return false;
        if (status !== 'all' && room.status !== status) return false;
        return true;
      }),
    [rooms.data, kind, status],
  );

  return (
    <SectionShell
      slug="rooms"
      toolbar={
        <>
          <Select
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
            aria-label="Filter by room type"
            containerClassName="sm:w-52"
          />
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            aria-label="Filter by status"
            containerClassName="sm:w-44"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={rooms.isLoading}
        isError={rooms.isError}
        onRetry={() => void rooms.refetch()}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(tally) as RoomStatus[]).map((key) => (
              <div
                key={key}
                className="flex flex-col gap-1 rounded-surface border border-border bg-surface p-3"
              >
                <Overline>{ROOM_STATUS_LABEL[key]}</Overline>
                <span className="text-h4 font-bold text-text-primary tabular-nums">
                  {tally[key]}
                </span>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-surface border border-dashed border-border px-4 py-10 text-center text-body-sm text-text-secondary">
              No rooms match these filters.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((room) => (
                <article
                  key={room.id}
                  // No coloured card edge (Medora uses none, by design): the
                  // room's status is its badge.
                  className="flex flex-col gap-3 rounded-surface border border-border bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <DoorOpen
                        aria-hidden="true"
                        className="h-4 w-4 text-text-tertiary"
                        strokeWidth={1.75}
                      />
                      <span className="text-body font-semibold text-text-primary">{room.name}</span>
                    </div>
                    <StatusBadge
                      status={ROOM_STATUS_KIND[room.status]}
                      label={ROOM_STATUS_LABEL[room.status]}
                    />
                  </div>
                  <div className="flex items-center justify-between text-caption text-text-tertiary">
                    <span>{KIND_LABEL[room.kind]}</span>
                    <span className="tabular-nums">capacity {room.capacity}</span>
                  </div>
                  {room.note ? (
                    <p className="text-caption text-text-secondary">{room.note}</p>
                  ) : null}
                  {/* Turning a room over is the action this board exists for,
                      so the status is editable on the card itself. */}
                  <Select
                    options={STATUS_FIELD_OPTIONS}
                    value={room.status}
                    onChange={(next) => {
                      update.mutate(
                        { id: room.id, changes: { status: next as RoomStatus } },
                        {
                          onSuccess: () =>
                            toast({
                              variant: 'success',
                              title: room.name + ' — ' + ROOM_STATUS_LABEL[next as RoomStatus],
                            }),
                          onError: () => toast({ variant: 'error', title: "Couldn't update " + room.name }),
                        },
                      );
                    }}
                    aria-label={'Set status for ' + room.name}
                  />
                </article>
              ))}
            </div>
          )}
        </div>
      </AsyncSection>
    </SectionShell>
  );
}
