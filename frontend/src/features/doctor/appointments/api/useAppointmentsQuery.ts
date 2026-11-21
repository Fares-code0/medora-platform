import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { dashboardKeys } from '@/features/doctor/dashboard/api/useDashboardOverviewQuery';
import { patientKeys } from '@/features/shared-domain/patient-identity';

import type { AppointmentCommand, CreateAppointmentInput } from '../model/appointment-service';
import type { WeeklyAvailability } from '../model/availability';
import type { ResolutionAction, TimeOffKind } from '../model/time-off-service';
import { appointmentService, availabilityService, timeOffService } from '../service';

/**
 * Appointments data layer, through the appointments port (FE-10.3): the
 * session mock store or the API, by the seam's flag. Writes are
 * pessimistic — the page shows the result the service returns, and a
 * refused transition leaves the book as it was.
 */

export type { AppointmentCommand, CreateAppointmentInput };

export const appointmentKeys = createKeyFactory('doctor-appointments');

/**
 * Everything an appointment change can make stale, not only this feature's
 * book. The Overview counts and lists appointments (its KPIs, today's
 * schedule and the decision list), and a patient's chart has an Appointments
 * tab. Invalidating the book alone left a request the doctor had just
 * approved still waiting on the Overview until its 30-second stale time ran
 * out, which is exactly the trip Overview → request → approve → back makes.
 */
export function invalidateAfterAppointmentChange(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  void queryClient.invalidateQueries({ queryKey: patientKeys.details() });
}

/**
 * `enabled` exists for the global search index (D-26), which spans five
 * feature datasets and must not fetch any of them until someone actually
 * uses the field. Defaults to true, so every existing caller is unchanged.
 */
export function useAppointmentsQuery(options?: { readonly enabled?: boolean }) {
  return useQuery({
    queryKey: appointmentKeys.lists(),
    queryFn: () => appointmentService.listAppointments(),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function useAppointmentActionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: AppointmentCommand }) =>
      appointmentService.runAction(id, command),
    // Refused too: the server refuses a transition when the appointment has
    // moved on (the patient cancelled, a colleague acted), and the row still
    // offers the actions of the state it left. Re-reading shows what it is.
    onSettled: () => invalidateAfterAppointmentChange(queryClient),
  });
}

export function useCreateAppointmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAppointmentInput) => appointmentService.createAppointment(input),
    onSuccess: () => invalidateAfterAppointmentChange(queryClient),
  });
}

/** Books a block of time off; returns the appointments it would disturb. */
const timeOffKey = [...appointmentKeys.all, 'time-off'] as const;

export function useCreateTimeOffMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string; kind: TimeOffKind }) =>
      timeOffService.createBlock(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: timeOffKey });
    },
  });
}

/** The doctor's upcoming time off (API §3.9), soonest first. */
export function useUpcomingTimeOffQuery(options?: { readonly enabled?: boolean }) {
  return useQuery({
    queryKey: timeOffKey,
    queryFn: () => timeOffService.listBlocks(),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Cancels a block — pessimistic: the row leaves the list from the refetch,
 * so a refused delete never shows the time as freed.
 */
export function useRemoveTimeOffMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) => timeOffService.removeBlock(blockId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: timeOffKey });
    },
  });
}

/** Acts on a block's impact; the book is refetched whatever the outcome. */
export function useResolveTimeOffMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      blockId,
      ...input
    }: {
      blockId: string;
      action: ResolutionAction;
      confirmedCount: number;
      reason?: string;
    }) => timeOffService.resolve(blockId, input),
    // Resolving a block can cancel or move the appointments inside it.
    onSettled: () => invalidateAfterAppointmentChange(queryClient),
  });
}

/** The doctor's weekly working hours (DEC-005, API §3.8). */
export const availabilityKey = [...appointmentKeys.all, 'availability'] as const;

export function useAvailabilityQuery() {
  return useQuery({
    queryKey: availabilityKey,
    queryFn: () => availabilityService.get(),
    staleTime: 30_000,
  });
}

/**
 * Replaces the week — pessimistic: the editor shows the grid from the
 * refetch, so a refused save never looks kept. It moves no appointment.
 */
export function useReplaceAvailabilityMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (next: WeeklyAvailability) => availabilityService.replace(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: availabilityKey }),
  });
}

/**
 * The doctor's whole book, fetched now rather than from cache — what the
 * availability editor checks a proposed week against before saving it.
 * Rejects when the book cannot be read in full, so the caller can say the
 * check did not run instead of reporting "none affected".
 */
export function useFreshAppointmentsFetcher() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.fetchQuery({
      queryKey: appointmentKeys.lists(),
      queryFn: () => appointmentService.listAppointments(),
      staleTime: 0,
    });
}
