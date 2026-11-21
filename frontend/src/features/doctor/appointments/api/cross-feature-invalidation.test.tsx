import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dashboardKeys } from '@/features/doctor/dashboard/api/useDashboardOverviewQuery';
import {
  useEndPrescriptionMutation,
  useSignPrescriptionMutation,
} from '@/features/doctor/pharmacy/api/usePrescriptionMutations';
import type { SignablePrescription } from '@/features/doctor/pharmacy/model/safety-check';
import type { Prescription } from '@/features/doctor/pharmacy/model/types';
import { prescriptionService } from '@/features/doctor/pharmacy/service';
import { patientKeys } from '@/features/shared-domain/patient-identity';

import type { Appointment } from '../model/types';
import { appointmentService, timeOffService } from '../service';

import {
  appointmentKeys,
  useAppointmentActionMutation,
  useCreateAppointmentMutation,
  useResolveTimeOffMutation,
} from './useAppointmentsQuery';

/**
 * A change in one feature is read by others under their own keys. An
 * appointment transition changes the Overview (KPIs, today, the decision
 * list) and the patient chart's Appointments tab; a signed or ended
 * prescription changes the chart's medication list. Each mutation used to
 * refresh only its own feature's cache, so the Overview still showed a request
 * the doctor had just approved until its 30-second stale time ran out.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const keys = () => invalidated.mock.calls.map(([filters]) => filters?.queryKey);
  return { wrapper, keys };
}

const APPOINTMENT = { id: 'APT-1' } as Appointment;
const PRESCRIPTION = { id: 'RX-1' } as Prescription;

describe('appointment changes refresh what reads appointments', () => {
  it('a transition refreshes the book, the Overview and the chart', async () => {
    vi.spyOn(appointmentService, 'runAction').mockResolvedValue(APPOINTMENT);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useAppointmentActionMutation(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'APT-1', command: { kind: 'approve' } }));

    expect(keys()).toEqual(
      expect.arrayContaining([appointmentKeys.all, dashboardKeys.all, patientKeys.details()]),
    );
  });

  it('a booking does the same', async () => {
    vi.spyOn(appointmentService, 'createAppointment').mockResolvedValue(APPOINTMENT);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useCreateAppointmentMutation(), { wrapper });

    await act(() =>
      result.current.mutateAsync({} as Parameters<typeof appointmentService.createAppointment>[0]),
    );

    expect(keys()).toEqual(expect.arrayContaining([dashboardKeys.all, patientKeys.details()]));
  });

  it('resolving a time-off block, which can cancel or move appointments, does too', async () => {
    vi.spyOn(timeOffService, 'resolve').mockResolvedValue(
      {} as Awaited<ReturnType<typeof timeOffService.resolve>>,
    );
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useResolveTimeOffMutation(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ blockId: 'B-1', action: 'cancel-apology', confirmedCount: 1 }),
    );

    expect(keys()).toEqual(expect.arrayContaining([dashboardKeys.all, patientKeys.details()]));
  });
});

describe('prescription changes refresh the chart’s medications', () => {
  it('signing', async () => {
    vi.spyOn(prescriptionService, 'sign').mockResolvedValue(PRESCRIPTION);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useSignPrescriptionMutation(), { wrapper });

    await act(() => result.current.mutateAsync({} as SignablePrescription));

    expect(keys()).toContainEqual(patientKeys.details());
  });

  it('discontinuing', async () => {
    vi.spyOn(prescriptionService, 'discontinue').mockResolvedValue(PRESCRIPTION);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useEndPrescriptionMutation(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        act: 'discontinue',
        prescriptionId: 'RX-1',
        reason: 'Done',
      } as Parameters<typeof result.current.mutateAsync>[0]),
    );

    expect(keys()).toContainEqual(patientKeys.details());
  });
});
