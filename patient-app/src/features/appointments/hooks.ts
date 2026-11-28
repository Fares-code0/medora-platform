import { useRef } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usePagedQuery, type PagedQuery } from '@/api/paged';
import { createKeyFactory } from '@/api/query-keys';
import { isApiError } from '@/types/api';
import { randomId } from '@/utils/id';

import type {
  Appointment,
  BookingRequest,
  CancelRequest,
  RescheduleSubmission,
} from './model/types';
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
    // Under the appointments domain so a booking invalidates it and a
    // sign-out clears it with everything else.
    queryKey: [...appointmentKeys.all, 'slots', doctorId, fromIso, toIso],
    queryFn: () => appointmentService.listSlots(doctorId, fromIso, toIso),
    enabled,
    // Slots go stale the moment somebody else books one. Short, and
    // refetched on focus, so a patient returning to the step does not
    // submit against a list from ten minutes ago.
    staleTime: 15_000,
  });
}

/** The optional visit-type select. Reference data, so it may sit for a while. */
export function useVisitTypes() {
  return useQuery({
    queryKey: [...appointmentKeys.all, 'visit-types'],
    queryFn: () => appointmentService.listVisitTypes(),
    staleTime: 10 * 60_000,
  });
}

/** Reschedule requests for one appointment, newest first. */
export function useRescheduleRequests(appointmentId: string) {
  return useQuery({
    queryKey: [...appointmentKeys.detail(appointmentId), 'reschedule-requests'],
    queryFn: () => appointmentService.listRescheduleRequests(appointmentId),
  });
}

/**
 * One idempotency key per ATTEMPT, not per call.
 *
 * The key is held for as long as the attempt is the same attempt: the
 * same `fingerprint` (what is being asked for) after an outcome the
 * patient could not see — a timeout, a dropped connection, a 5xx, where
 * the server may or may not have applied it. Sending the retry under the
 * same key is what lets the server answer with the first result instead
 * of creating a second one; a key regenerated on retry is not an
 * idempotency key.
 *
 * It is released when the outcome is KNOWN — a success, or a definite
 * refusal (409, 422, 404…): the next press is then a new attempt and must
 * not replay a stored refusal. Editing what is asked for changes the
 * fingerprint and so also starts a new key.
 */
function useAttemptKey() {
  const held = useRef<{ readonly fingerprint: string; readonly key: string } | null>(null);
  return {
    keyFor(fingerprint: string): string {
      if (held.current?.fingerprint !== fingerprint) {
        held.current = { fingerprint, key: randomId() };
      }
      return held.current.key;
    },
    /** Releases the key unless the outcome is one the patient could not see. */
    settle(error: unknown): void {
      if (error !== undefined && isOutcomeUnknown(error)) return;
      held.current = null;
    },
  };
}

/** True when the request may or may not have been applied. */
function isOutcomeUnknown(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server';
}

/**
 * Booking.
 *
 * Sends an `Idempotency-Key` per attempt so a lost response cannot become
 * two appointments (ADR-014, API §0.5); see `useAttemptKey` for what
 * "per attempt" means.
 *
 * Not retried automatically: `createQueryClient` sets `mutations.retry:
 * false`, and a booking replayed against a slot that no longer exists is
 * worse than a clear failure (audit §12.4).
 */
export function useBookAppointment() {
  const queryClient = useQueryClient();
  const attempt = useAttemptKey();
  return useMutation({
    mutationFn: (request: BookingRequest) =>
      appointmentService.book(
        request,
        attempt.keyFor(
          JSON.stringify([
            request.slotId,
            request.reason,
            request.visitTypeId ?? null,
            request.notes ?? null,
          ]),
        ),
      ),
    onSuccess: () => attempt.settle(undefined),
    onError: (error) => attempt.settle(error),
    onSettled: () => {
      // Success changes the list; a lost race changes the slots. Either
      // way what is cached is no longer the server's answer.
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

export function useCancelAppointment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CancelRequest) => appointmentService.cancel(id, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

/**
 * Asks for a new time. The appointment is NOT moved — the hospital
 * decides — so on success the detail, the list and the request history
 * are refetched rather than patched: nothing about the appointment is
 * known to have changed except that a request now exists.
 */
export function useRequestReschedule(id: string) {
  const queryClient = useQueryClient();
  const attempt = useAttemptKey();
  return useMutation({
    mutationFn: (submission: RescheduleSubmission) =>
      appointmentService.requestReschedule(
        id,
        submission,
        attempt.keyFor(JSON.stringify([submission.slotId, submission.note ?? null])),
      ),
    onSuccess: () => attempt.settle(undefined),
    onError: (error) => attempt.settle(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

export function useWithdrawRescheduleRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => appointmentService.withdrawRescheduleRequest(requestId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}
