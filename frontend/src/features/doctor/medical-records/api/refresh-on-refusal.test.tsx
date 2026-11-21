import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appointmentKeys,
  useAppointmentActionMutation,
} from '@/features/doctor/appointments/api/useAppointmentsQuery';
import { appointmentService } from '@/features/doctor/appointments/service';
import { dashboardKeys } from '@/features/doctor/dashboard/api/useDashboardOverviewQuery';
import {
  useBulkMarkReviewedMutation,
  useMarkReviewedMutation,
} from '@/features/doctor/labs/api/useLabReviewMutations';
import { labKeys } from '@/features/doctor/labs/api/useLabTestsQuery';
import type { ReviewableTest } from '@/features/doctor/labs/model/review';
import { labService } from '@/features/doctor/labs/service';
import { useSignPrescriptionMutation } from '@/features/doctor/pharmacy/api/usePrescriptionMutations';
import {
  prescriptionDraftKeys,
  prescriptionKeys,
} from '@/features/doctor/pharmacy/api/usePrescriptionsQuery';
import type { SignablePrescription } from '@/features/doctor/pharmacy/model/safety-check';
import { prescriptionService } from '@/features/doctor/pharmacy/service';

import type { SetRecordStatusInput } from '../model/record-service';
import { recordService } from '../service';

import { medicalRecordKeys } from './useMedicalRecordsQuery';
import { useSetRecordStatusMutation } from './useRecordMutations';

/**
 * A refused write is often the server saying the screen is out of date: a
 * record's `stale_write` ("reload and try again"), a lab result a colleague
 * reviewed first, a bulk review whose transaction committed the rest before
 * answering 409, a transition on an appointment the patient already
 * cancelled. Every one of these refreshed only on success, so the screen kept
 * showing the state the server had just refused, and the retry the message
 * invites failed the same way.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const conflict = (code: string) =>
  Object.assign(new Error(code), { kind: 'conflict', code, detail: 'Reload and try again' });

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const keys = () => invalidated.mock.calls.map(([filters]) => filters?.queryKey);
  return { wrapper, keys };
}

async function settle(run: () => Promise<unknown>) {
  await act(async () => {
    await run().catch(() => undefined);
  });
}

describe('a record write the server refuses as stale', () => {
  const input = { recordId: 'MR-1' } as SetRecordStatusInput;

  it('re-reads the record and the lists', async () => {
    vi.spyOn(recordService, 'setStatus').mockRejectedValue(conflict('stale_write'));
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useSetRecordStatusMutation(), { wrapper });

    await settle(() => result.current.mutateAsync(input));

    expect(keys()).toEqual(
      expect.arrayContaining([medicalRecordKeys.detail('MR-1'), medicalRecordKeys.lists()]),
    );
  });

  it('leaves the cache alone for a failure that says nothing about the record', async () => {
    vi.spyOn(recordService, 'setStatus').mockRejectedValue(
      Object.assign(new Error('down'), { kind: 'network' }),
    );
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useSetRecordStatusMutation(), { wrapper });

    await settle(() => result.current.mutateAsync(input));

    expect(keys()).toEqual([]);
  });
});

describe('a lab review the server refuses', () => {
  const reviewable = { labId: 'LAB-1' } as ReviewableTest;

  it('re-reads the order and the worklist when a colleague reviewed it first', async () => {
    vi.spyOn(labService, 'markReviewed').mockRejectedValue(conflict('conflict'));
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useMarkReviewedMutation(), { wrapper });

    await settle(() => result.current.mutateAsync(reviewable));

    expect(keys()).toEqual(expect.arrayContaining([labKeys.detail('LAB-1'), labKeys.lists()]));
  });

  it('re-reads the worklist after a bulk 409, whose transaction kept the rest', async () => {
    vi.spyOn(labService, 'markManyReviewed').mockRejectedValue(conflict('conflict'));
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useBulkMarkReviewedMutation(), { wrapper });

    await settle(() => result.current.mutateAsync([reviewable]));

    expect(keys()).toContainEqual(labKeys.lists());
  });
});

describe('an appointment transition the server refuses', () => {
  it('re-reads the book and the Overview', async () => {
    vi.spyOn(appointmentService, 'runAction').mockRejectedValue(conflict('invalid_transition'));
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useAppointmentActionMutation(), { wrapper });

    await settle(() => result.current.mutateAsync({ id: 'APT-1', command: { kind: 'approve' } }));

    expect(keys()).toEqual(expect.arrayContaining([appointmentKeys.all, dashboardKeys.all]));
  });
});

describe('a signature the server refuses', () => {
  it('re-reads prescriptions when someone else signed it first', async () => {
    vi.spyOn(prescriptionService, 'sign').mockRejectedValue(conflict('conflict'));
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useSignPrescriptionMutation(), { wrapper });

    await settle(() => result.current.mutateAsync({} as SignablePrescription));

    expect(keys()).toEqual(
      expect.arrayContaining([prescriptionKeys.all, prescriptionDraftKeys.all]),
    );
  });

  it('leaves the cache alone for a safety refusal the flow reports itself', async () => {
    vi.spyOn(prescriptionService, 'sign').mockRejectedValue(conflict('allergy_conflict'));
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useSignPrescriptionMutation(), { wrapper });

    await settle(() => result.current.mutateAsync({} as SignablePrescription));

    expect(keys()).toEqual([]);
  });
});
