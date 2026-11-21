import { useQuery } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import type { HistoryEvent } from './model/types';
import { healthService } from './service';

/**
 * Health-record queries.
 *
 * The key domains — `health-records` and `lab-results` — are both listed
 * in `PHI_QUERY_DOMAINS`, so `clearPhiCache` removes them on logout, on
 * session loss and after a background timeout (checklist J-10, T-03).
 * A new PHI query here must use one of those domains or add its own to
 * that list.
 */
export const healthKeys = createKeyFactory('health-records');
export const labKeys = createKeyFactory('lab-results');

export function useAllergies() {
  return useQuery({
    queryKey: [...healthKeys.all, 'allergies'],
    queryFn: () => healthService.listAllergies(),
  });
}

export function useConditions() {
  return useQuery({
    queryKey: [...healthKeys.all, 'conditions'],
    queryFn: () => healthService.listConditions(),
  });
}

export function useMedications() {
  return useQuery({
    queryKey: [...healthKeys.all, 'medications'],
    queryFn: () => healthService.listMedications(),
  });
}

/**
 * When an event happened, as a number that always compares.
 *
 * `occurredOn` is a server string and an unparseable one must not make
 * the comparator return `NaN` — a `NaN` comparison leaves `sort` free to
 * produce any order at all, which is a worse failure than a misplaced
 * row because it is not reproducible. An event whose date cannot be read
 * sorts to the end instead, where `formatLongDate` will render the raw
 * string rather than invent a date for it.
 */
function occurredAt(event: HistoryEvent): number {
  const parsed = Date.parse(event.occurredOn);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Newest first — checklist J-05, and the client's job rather than the
 * server's.
 *
 * The ordering is part of what the row promises, so this client does not
 * rely on a `GET /me/health/history` that does not exist yet to promise
 * it back. Sorting here also means the fixture adapter and the HTTP
 * adapter cannot disagree about it: the seam carries records, not an
 * order.
 *
 * It lives in `select` rather than in the screen because react-query
 * memoises a stable module-level `select` against the cached data, so a
 * re-render for an unrelated reason does not re-sort the list.
 */
function newestFirst(events: readonly HistoryEvent[]): readonly HistoryEvent[] {
  return [...events].sort((a, b) => occurredAt(b) - occurredAt(a));
}

export function useHistory() {
  return useQuery({
    queryKey: [...healthKeys.all, 'history'],
    queryFn: () => healthService.listHistory(),
    select: newestFirst,
  });
}

export function usePrescriptions() {
  return useQuery({
    queryKey: [...healthKeys.all, 'prescriptions'],
    queryFn: () => healthService.listPrescriptions(),
  });
}

export function useVisits() {
  return useQuery({
    queryKey: [...healthKeys.all, 'visits'],
    queryFn: () => healthService.listVisits(),
  });
}

/**
 * One visit summary, read out of the list rather than fetched (J-08).
 *
 * There is no `GET /me/health/visits/{id}` — the contract has the list
 * and nothing else — and §11 of the brief forbids inventing the route
 * that would make a detail query tidy. So the detail screen selects from
 * the same query the list uses: same key, same cache, one request, and
 * nothing here names an endpoint that does not exist.
 *
 * `null` rather than `undefined` for a visit that is not in the record.
 * `AsyncBoundary` reads `undefined` as *still loading* and would show a
 * skeleton for ever; `null` is an answer, and the screen renders it as
 * one.
 */
export function useVisit(id: string) {
  return useQuery({
    queryKey: [...healthKeys.all, 'visits'],
    queryFn: () => healthService.listVisits(),
    select: (visits) => visits.find((visit) => visit.id === id) ?? null,
  });
}

/**
 * The patient's emergency contacts (N-08).
 *
 * `enabled` because the only screen that renders them also renders
 * signed out, where there is no `/me` to read: the Emergency screen
 * passes `false` and no request is made. It sits under `healthKeys`, so
 * `clearPhiCache` sweeps it with the rest of the record — a family
 * member's name and phone number is exactly the kind of value that must
 * not survive a logout into the next session.
 */
export function useEmergencyContacts(enabled: boolean) {
  return useQuery({
    queryKey: [...healthKeys.all, 'emergency-contacts'],
    queryFn: () => healthService.listEmergencyContacts(),
    enabled,
  });
}

export function useDocuments() {
  return useQuery({
    queryKey: [...healthKeys.all, 'documents'],
    queryFn: () => healthService.listDocuments(),
  });
}

export function useLabOrders() {
  return useQuery({ queryKey: labKeys.lists(), queryFn: () => healthService.listLabOrders() });
}

export function useLabOrder(id: string) {
  return useQuery({
    queryKey: labKeys.detail(id),
    queryFn: () => healthService.getLabOrder(id),
  });
}
