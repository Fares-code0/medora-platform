import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usePagedQuery, type PagedQuery } from '@/api/paged';
import { createKeyFactory } from '@/api/query-keys';
import { randomId } from '@/utils/id';

import type { Appointment, BookingRequest } from './model/types';
import { appointmentService } from './service';

export const appointmentKeys = createKeyFactory('appointments');

/**
 * A patient's appointments, one page at a time.
 *
 * Both segments page, not only Past. Upcoming is the shorter of the two
 * for most patients and the longer one for a patient in a course of
 * treatment, and a list that silently stops at the page boundary is the
 * same defect either way.
 *
 * The scope is part of the query key, so switching segment reads its own
 * cache rather than paging into the other one.
 */
export function useAppointments(scope: 'upcoming' | 'past'): PagedQuery<Appointment> {
  return usePagedQuery({
    queryKey: appointmentKeys.list({ scope }),
    queryFn: (page) => appointmentService.list(scope, page),
  });
}

export function useAppointment(id: string) {
  return useQuery({
    queryKey: appointmentKeys.detail(id),
    queryFn: () => appointmentService.getById(id),
  });
}

export function useSlots(doctorId: string, fromIso: string, toIso: string, enabled = true) {
  return useQuery({
    queryKey: ['slots', doctorId, fromIso, toIso],
    queryFn: () => appointmentService.listSlots(doctorId, fromIso, toIso),
    enabled,
    // Slots go stale the moment somebody else books one. Short, and
    // refetched on focus, so a patient returning to the step does not
    // submit against a list from ten minutes ago.
    staleTime: 15_000,
  });
}

/**
 * Booking.
 *
 * Sends an `Idempotency-Key` per attempt so a lost response cannot become
 * two appointments (ADR-014, API §0.5). The key is generated ONCE per
 * booking attempt and reused across retries of that attempt — a key
 * regenerated on retry is not an idempotency key.
 *
 * Not retried automatically: `createQueryClient` sets `mutations.retry:
 * false`, and a booking replayed against a slot that no longer exists is
 * worse than a clear failure (audit §12.4).
 */
export function useBookAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: BookingRequest) => appointmentService.book(request, randomId()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

export function useCancelAppointment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => appointmentService.cancel(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

export function useRequestReschedule(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => appointmentService.requestReschedule(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

export function useAcceptProposal(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slotId: string) => appointmentService.acceptProposal(id, slotId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}
