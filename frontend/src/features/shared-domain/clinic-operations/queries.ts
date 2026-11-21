/**
 * Clinic operations — TanStack Query hooks (Phase 17; writes added in
 * Phase B; moved to shared-domain by D-27b). One query per dataset, keyed
 * under a shared `administration` namespace so the whole area can be
 * invalidated by prefix.
 *
 * The keys keep their `administration` prefix deliberately. Renaming them
 * would be cosmetic churn, and worse, a *second* namespace is the failure
 * mode this move exists to prevent: the administrator's board and the
 * doctor's board read the same queue, so they must read the same cache
 * entry or they will show different queues for the same clinic.
 *
 * Mutations seed the cache with `setQueryData` from the full collection the
 * API returns, rather than invalidating and refetching. That is the
 * StrictMode-safe pattern used across the app: mutate-level `onSuccess`
 * callbacks are unreliable under StrictMode, so nothing is gated on them.
 */

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

import {
  clinicOperationsApi,
  type ClinicDocument,
  type EditableClinicCollection,
} from './store';
import type { PhiAccessEvent, WorkingDay } from './types';

const STALE_MS = 60_000;

export const administrationKeys = {
  all: ['administration'] as const,
  overview: () => [...administrationKeys.all, 'overview'] as const,
  staff: () => [...administrationKeys.all, 'staff'] as const,
  departments: () => [...administrationKeys.all, 'departments'] as const,
  rooms: () => [...administrationKeys.all, 'rooms'] as const,
  resources: () => [...administrationKeys.all, 'resources'] as const,
  schedule: () => [...administrationKeys.all, 'schedule'] as const,
  holidays: () => [...administrationKeys.all, 'holidays'] as const,
  shifts: () => [...administrationKeys.all, 'shifts'] as const,
  queue: () => [...administrationKeys.all, 'queue'] as const,
  waitingRoom: () => [...administrationKeys.all, 'waiting-room'] as const,
  announcements: () => [...administrationKeys.all, 'announcements'] as const,
  policies: () => [...administrationKeys.all, 'policies'] as const,
  templates: () => [...administrationKeys.all, 'templates'] as const,
  auditEvents: () => [...administrationKeys.all, 'audit-events'] as const,
  phiAccessLog: () => [...administrationKeys.all, 'phi-access-log'] as const,
  platformStatus: () => [...administrationKeys.all, 'platform-status'] as const,
} as const;

/* ── Standalone reads ─────────────────────────────────────────── */

export function useOverview() {
  return useQuery({
    queryKey: administrationKeys.overview(),
    queryFn: clinicOperationsApi.getOverview,
    staleTime: STALE_MS,
  });
}

export function usePhiAccessLog() {
  return useQuery({
    queryKey: administrationKeys.phiAccessLog(),
    queryFn: clinicOperationsApi.phiAccess.list,
    staleTime: STALE_MS,
  });
}

/**
 * Writes one justified PHI reveal (ADM-10). The audit feed is invalidated
 * rather than seeded: it is a *derived* read (seeded events merged with the
 * log), so the only honest way to refresh it is to ask the API again.
 */
export function useRecordPhiAccessMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: Omit<PhiAccessEvent, 'id' | 'at'>) =>
      clinicOperationsApi.phiAccess.record(draft),
    onSuccess: (log) => {
      queryClient.setQueryData(administrationKeys.phiAccessLog(), log);
      void queryClient.invalidateQueries({ queryKey: administrationKeys.auditEvents() });
    },
  });
}

export function usePlatformStatus() {
  return useQuery({
    queryKey: administrationKeys.platformStatus(),
    queryFn: clinicOperationsApi.getPlatformStatus,
    staleTime: STALE_MS,
  });
}

/* ── Collections ──────────────────────────────────────────────── */

type Item<K extends EditableClinicCollection> = ClinicDocument[K][number];

/** Read hook for one collection. */
function useCollection<K extends EditableClinicCollection>(key: K, queryKey: QueryKey) {
  // The indexed access `clinicOperationsApi[key]` widens to a union of the
  // per-collection CRUD objects, which erases the element type; the explicit
  // type argument and casts put it back.
  return useQuery<ClinicDocument[K]>({
    queryKey,
    queryFn: () => clinicOperationsApi[key].list() as Promise<ClinicDocument[K]>,
    staleTime: STALE_MS,
  });
}

/**
 * Write hooks for one collection. Each mutation resolves to the full patched
 * collection, which is written straight into the cache — so the list on
 * screen updates without a refetch and without depending on mutate-level
 * callbacks.
 */
function useCollectionMutations<K extends Exclude<EditableClinicCollection, 'workingSchedule'>>(
  key: K,
  queryKey: QueryKey,
) {
  const queryClient = useQueryClient();
  const seed = (next: ClinicDocument[K]) => {
    queryClient.setQueryData(queryKey, next);
  };

  const api = clinicOperationsApi[key] as unknown as {
    create: (draft: Omit<Item<K>, 'id'>) => Promise<ClinicDocument[K]>;
    update: (id: string, changes: Partial<Item<K>>) => Promise<ClinicDocument[K]>;
    remove: (id: string) => Promise<ClinicDocument[K]>;
    replace: (next: ClinicDocument[K]) => Promise<ClinicDocument[K]>;
  };

  const create = useMutation({ mutationFn: api.create, onSuccess: seed });

  const update = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<Item<K>> }) =>
      api.update(id, changes),
    onSuccess: seed,
  });

  const remove = useMutation({ mutationFn: api.remove, onSuccess: seed });

  const replace = useMutation({ mutationFn: api.replace, onSuccess: seed });

  return { create, update, remove, replace };
}

export function useStaff() {
  return useCollection('staff', administrationKeys.staff());
}
export function useStaffMutations() {
  return useCollectionMutations('staff', administrationKeys.staff());
}

export function useDepartments() {
  return useCollection('departments', administrationKeys.departments());
}
export function useDepartmentMutations() {
  return useCollectionMutations('departments', administrationKeys.departments());
}

export function useRooms() {
  return useCollection('rooms', administrationKeys.rooms());
}
export function useRoomMutations() {
  return useCollectionMutations('rooms', administrationKeys.rooms());
}

export function useResources() {
  return useCollection('resources', administrationKeys.resources());
}
export function useResourceMutations() {
  return useCollectionMutations('resources', administrationKeys.resources());
}

export function useWorkingSchedule() {
  return useCollection('workingSchedule', administrationKeys.schedule());
}
/** The weekly schedule is edited per weekday; see `store.ts`. */
export function useWorkingScheduleMutations() {
  const queryClient = useQueryClient();
  const setDay = useMutation({
    mutationFn: ({ day, changes }: { day: WorkingDay['day']; changes: Partial<WorkingDay> }) =>
      clinicOperationsApi.workingSchedule.setDay(day, changes),
    onSuccess: (next) => {
      queryClient.setQueryData(administrationKeys.schedule(), next);
    },
  });
  return { setDay };
}

export function useHolidays() {
  return useCollection('holidays', administrationKeys.holidays());
}
export function useHolidayMutations() {
  return useCollectionMutations('holidays', administrationKeys.holidays());
}

export function useShifts() {
  return useCollection('shifts', administrationKeys.shifts());
}
export function useShiftMutations() {
  return useCollectionMutations('shifts', administrationKeys.shifts());
}

export function useQueue() {
  return useCollection('queue', administrationKeys.queue());
}
export function useQueueMutations() {
  return useCollectionMutations('queue', administrationKeys.queue());
}

export function useWaitingRoom() {
  return useCollection('waitingRoom', administrationKeys.waitingRoom());
}
export function useWaitingRoomMutations() {
  return useCollectionMutations('waitingRoom', administrationKeys.waitingRoom());
}

export function useAnnouncements() {
  return useCollection('announcements', administrationKeys.announcements());
}
export function useAnnouncementMutations() {
  return useCollectionMutations('announcements', administrationKeys.announcements());
}

export function usePolicies() {
  return useCollection('policies', administrationKeys.policies());
}
export function usePolicyMutations() {
  return useCollectionMutations('policies', administrationKeys.policies());
}

export function useTemplates() {
  return useCollection('templates', administrationKeys.templates());
}
export function useTemplateMutations() {
  return useCollectionMutations('templates', administrationKeys.templates());
}
