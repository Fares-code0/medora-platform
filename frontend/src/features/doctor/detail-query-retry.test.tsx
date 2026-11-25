import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { ApiError } from '@/types/api';

import { useLabTestQuery } from './labs/api/useLabTestsQuery';
import { labService } from './labs/service';
import { useMedicalRecordQuery } from './medical-records/api/useMedicalRecordsQuery';
import { recordService } from './medical-records/service';
import { usePatientProfileQuery } from './patients/api/usePatientProfileQuery';
import { patientProfileService } from './patients/service';
import { usePrescriptionQuery } from './pharmacy/api/usePrescriptionsQuery';
import { prescriptionService } from './pharmacy/service';

/**
 * The detail reads carry their own `retry` (so a not-found is never retried),
 * and that used to replace the global rule in `configs/query-client.ts`
 * wholesale: a 403 or a 500 was re-sent twice more behind a spinner. The
 * global rule now runs first — only a network failure is retried.
 */

const FORBIDDEN: ApiError = { kind: 'forbidden' };
const SERVER: ApiError = { kind: 'server', ref: 'r-1' };
const NETWORK: ApiError = { kind: 'network' };

function wrapper({ children }: { children: ReactNode }) {
  // No `retry` here: the hooks' own option is what is under test.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

interface Case {
  readonly name: string;
  readonly spy: () => MockInstance;
  readonly render: () => { result: { current: { isError: boolean } } };
}

const CASES: readonly Case[] = [
  {
    name: 'useLabTestQuery',
    spy: () => vi.spyOn(labService, 'getLabTest'),
    render: () => renderHook(() => useLabTestQuery('lab-x'), { wrapper }),
  },
  {
    name: 'useMedicalRecordQuery',
    spy: () => vi.spyOn(recordService, 'getRecord'),
    render: () => renderHook(() => useMedicalRecordQuery('rec-x'), { wrapper }),
  },
  {
    name: 'usePrescriptionQuery',
    spy: () => vi.spyOn(prescriptionService, 'getPrescription'),
    render: () => renderHook(() => usePrescriptionQuery('rx-x'), { wrapper }),
  },
  {
    name: 'usePatientProfileQuery',
    spy: () => vi.spyOn(patientProfileService, 'getProfile'),
    render: () => renderHook(() => usePatientProfileQuery('pt-x'), { wrapper }),
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(CASES)('$name retry policy', ({ spy, render }) => {
  it.each([
    ['403', FORBIDDEN],
    ['500', SERVER],
  ])('does not retry a %s', async (_label, error) => {
    const fn = spy().mockRejectedValue(error);
    const { result } = render();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('still retries a network failure twice', async () => {
    const fn = spy().mockRejectedValue(NETWORK);
    const { result } = render();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
