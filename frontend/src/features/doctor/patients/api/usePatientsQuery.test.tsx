import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { patientKeys, useCreatePatientMutation, usePatientsQuery } from './usePatientsQuery';

/**
 * Patients data layer — the reference shape every feature's `api/` module
 * follows (FRONTEND_ARCHITECTURE.md §10.3). Pins the parts that must
 * survive the mock → HTTP swap: the key namespace used for
 * invalidate-by-prefix, and create-then-refetch actually surfacing the new
 * row in the list.
 */

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const NEW_PATIENT = {
  name: 'Sara Test',
  dateOfBirth: '1990-04-01',
  gender: 'female',
  phone: '+1 (555) 000-0000',
  email: 'sara@example.test',
  address: '1 Test Street',
  bloodType: 'O+',
  insurance: 'TestCare',
  medicalNotes: '',
} as const;

describe('patientKeys', () => {
  it('namespaces every key so invalidate-by-prefix hits lists and details', () => {
    expect(patientKeys.all).toEqual(['doctor-patients']);
    expect(patientKeys.lists()[0]).toBe('doctor-patients');
    expect(patientKeys.detail('PT-1001')).toEqual(['doctor-patients', 'detail', 'PT-1001']);
  });
});

describe('usePatientsQuery', () => {
  it('loads the seeded roster', async () => {
    const { result } = renderHook(() => usePatientsQuery(), { wrapper: wrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.length).toBeGreaterThan(0);
    expect(result.current.data?.[0]).toHaveProperty('mrn');
  });
});

describe('useCreatePatientMutation', () => {
  it('derives the patient age from the date of birth', async () => {
    const { result } = renderHook(() => useCreatePatientMutation(), { wrapper: wrapper() });
    // A birthday exactly 30 years ago yesterday: unambiguously age 30 today,
    // and stable whatever day the suite runs on.
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);
    dob.setDate(dob.getDate() - 1);

    const created = await result.current.mutateAsync({
      input: { ...NEW_PATIENT, dateOfBirth: dob.toISOString().slice(0, 10) },
      doctor: 'Dr. Amelia Chen',
    });

    expect(created.age).toBe(30);
  });

  it('puts the new patient at the head of the refetched list', async () => {
    const Wrapper = wrapper();
    const list = renderHook(() => usePatientsQuery(), { wrapper: Wrapper });
    const create = renderHook(() => useCreatePatientMutation(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(list.result.current.isSuccess).toBe(true);
    });
    const before = list.result.current.data?.length ?? 0;

    await create.result.current.mutateAsync({
      input: { ...NEW_PATIENT, name: 'Newest Patient' },
      doctor: 'Dr. Amelia Chen',
    });

    await waitFor(() => {
      expect(list.result.current.data?.[0]?.name).toBe('Newest Patient');
    });
    expect(list.result.current.data?.length).toBe(before + 1);
  });
});
