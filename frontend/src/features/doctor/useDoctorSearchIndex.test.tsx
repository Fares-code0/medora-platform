import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '@/app/providers/AuthProvider';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { labKeys } from './labs/api/useLabTestsQuery';
import { useDoctorSearchIndex } from './useDoctorSearchIndex';

/**
 * D-26. The doctor shell mounted no search provider, so `GlobalSearch` fell
 * back to the context default — `search: () => []` — and answered every
 * query with "No matches", including for patients sitting in the roster.
 *
 * What is asserted here is that the index actually resolves the three things
 * the navbar's own placeholder has always promised ("Search patients,
 * appointments, records…"), and that it resolves them to real routes rather
 * than merely returning rows.
 */

const PATIENT = MOCK_PATIENTS[0];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Engages the field the way a doctor does, then waits for the five source
 * queries to settle. Activation is required: nothing is fetched until the
 * search is actually used (D-26 lazy index, ported from #63).
 */
async function readyIndex() {
  const { result } = renderHook(() => useDoctorSearchIndex(), { wrapper });
  act(() => {
    result.current.onActivate?.();
  });
  await waitFor(
    () => {
      expect(result.current.search('a').length).toBeGreaterThan(0);
      expect(result.current.pending).toBe(false);
    },
    { timeout: 8000 },
  );
  return result;
}

describe('the doctor search index', () => {
  it('fetches nothing until the field is engaged', () => {
    // Five datasets behind mock latency on every doctor page load is five
    // round trips spent on a control most page views never touch.
    const { result } = renderHook(() => useDoctorSearchIndex(), { wrapper });

    expect(result.current.pending).toBe(false);
    expect(result.current.search('khaled')).toEqual([]);
  });

  it('does not refetch the lab worklist on window focus', () => {
    // Over HTTP the worklist is one GET per order; the shell mounts this
    // index on every doctor page, so its observer must not re-run that
    // fan-out each time the tab regains focus.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { result } = renderHook(() => useDoctorSearchIndex(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AuthProvider>{children}</AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      ),
    });
    act(() => {
      result.current.onActivate?.();
    });

    const labs = client.getQueryCache().find({ queryKey: labKeys.lists(), exact: true });
    expect(labs?.observers).toHaveLength(1);
    expect(labs?.observers[0]?.options.refetchOnWindowFocus).toBe(false);
  });

  it('reports pending once engaged, so the panel cannot claim "no matches"', () => {
    const { result } = renderHook(() => useDoctorSearchIndex(), { wrapper });

    act(() => {
      result.current.onActivate?.();
    });

    expect(result.current.pending).toBe(true);
    expect(result.current.search('khaled')).toEqual([]);
  });

  it('returns nothing for an empty term', async () => {
    const result = await readyIndex();

    expect(result.current.search('')).toEqual([]);
    expect(result.current.search('   ')).toEqual([]);
  });

  it('finds a patient by name and routes to their record', async () => {
    const result = await readyIndex();
    const name = PATIENT?.name ?? '';

    const hit = result.current.search(name).find((r) => r.id === `patient-${PATIENT?.id ?? ''}`);
    expect(hit).toBeDefined();
    expect(hit?.path).toBe(`/doctor/patients/${PATIENT?.id ?? ''}`);
    expect(hit?.hint).toContain(PATIENT?.mrn ?? '');
  });

  it('finds a patient by MRN, which is what is on the wristband', async () => {
    const result = await readyIndex();
    const mrn = PATIENT?.mrn ?? '';

    const hits = result.current.search(mrn);
    expect(hits.some((r) => r.id === `patient-${PATIENT?.id ?? ''}`)).toBe(true);
  });

  it('indexes appointments and records, the other two the placeholder promises', async () => {
    const result = await readyIndex();
    const all = result.current.search(PATIENT?.name ?? '');

    expect(all.some((r) => r.id.startsWith('appointment-'))).toBe(true);
    expect(all.some((r) => r.id.startsWith('record-'))).toBe(true);
    for (const hit of all) {
      expect(hit.path.startsWith('/doctor/')).toBe(true);
    }
  });

  it('ranks the patient above the encounters that merely mention them', async () => {
    // The shell shows seven rows. A doctor typing a patient's name wants the
    // chart, not the third of their appointments, so ranking is load-bearing
    // rather than cosmetic.
    const result = await readyIndex();

    const first = result.current.search(PATIENT?.name ?? '')[0];
    expect(first?.id).toBe(`patient-${PATIENT?.id ?? ''}`);
  });

  it('ranks a prefix match ahead of a mid-word one', async () => {
    const result = await readyIndex();

    const hits = result.current.search('lab');
    // "Labs" (the destination) begins with the term; anything matching it
    // mid-word must come after.
    expect(hits[0]?.label).toBe('Labs');
    expect(hits[0]?.path).toBe('/doctor/labs');
  });

  it('makes the sidebar reachable as a command palette', async () => {
    const result = await readyIndex();

    expect(result.current.search('appointments').some((r) => r.path === '/doctor/appointments')).toBe(
      true,
    );
    expect(result.current.search('notification').some((r) => r.id === 'settings-notifications')).toBe(
      true,
    );
  });

  it('finds nothing for a term that matches nothing, without throwing', async () => {
    const result = await readyIndex();

    expect(result.current.search('qzxwv-no-such-thing')).toEqual([]);
  });
});

describe('what survives the seven-row panel', () => {
  /**
   * Ported from the parallel D-26 implementation in #63, which caught this
   * in a browser: a patient's name returned the patient and then five of
   * that patient's own appointments — six of seven slots on one fact, with
   * their labs, prescriptions and records invisible. My own browser run
   * produced the identical output and I read past it.
   */
  it('does not let one domain eat the head of the results', async () => {
    const result = await readyIndex();
    const name = PATIENT?.name ?? '';

    const head = result.current.search(name).slice(0, 7);
    const appointments = head.filter((r) => r.id.startsWith('appointment-'));

    expect(appointments.length).toBeLessThanOrEqual(3);
    expect(head[0]?.id).toBe(`patient-${PATIENT?.id ?? ''}`);
  });

  it('shows the patient’s other records rather than more of the same', async () => {
    const result = await readyIndex();
    const head = result.current.search(PATIENT?.name ?? '').slice(0, 7);
    const domains = new Set(head.map((r) => r.id.split('-')[0]));

    // More than just patient+appointment: the point of the cap is that the
    // rest of this patient's chart reaches the panel at all.
    expect(domains.size).toBeGreaterThan(2);
  });

  it('defers the overflow rather than dropping it', async () => {
    const result = await readyIndex();
    const all = result.current.search(PATIENT?.name ?? '');
    const head = all.slice(0, 7);

    // Everything still comes back; the cap only decides what leads.
    expect(all.length).toBeGreaterThan(head.length);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
  });

  it('still ranks a better match above a worse one, across domains', async () => {
    const result = await readyIndex();

    // Interleaving is within a score band only — "labs" is a prefix match on
    // the destination and must not be displaced by weaker matches elsewhere.
    expect(result.current.search('lab')[0]?.path).toBe('/doctor/labs');
  });
});
