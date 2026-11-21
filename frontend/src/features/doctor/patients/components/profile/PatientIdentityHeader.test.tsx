import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { PatientIdentityHeader } from './PatientIdentityHeader';

/**
 * The identity line ("MRN … · 52 y · Male · Blood O+") is Latin-only, so it
 * is pinned left-to-right as **one** run. Isolating only the blood group
 * would carry it to the far end of an RTL line — "O+ MRN … Blood" — which
 * is what the first attempt at this did (`docs/handoff/i18n.md` §5).
 */

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useDoctorProfile: () => ({ profile: actual.DEFAULT_DOCTOR_PROFILE }),
    useToast: () => ({ toast: vi.fn() }),
  };
});

const PATIENT = MOCK_PATIENTS[0];
if (PATIENT === undefined) throw new Error('roster is empty');

describe('PatientIdentityHeader in RTL', () => {
  it('keeps "Blood" and the blood group in one left-to-right run', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PatientIdentityHeader patient={PATIENT} allergies={[]} onViewRecord={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const run = screen.getByText(/Blood/).closest('[dir="ltr"]');
    expect(run).not.toBeNull();
    expect(run?.textContent).toContain(`MRN ${PATIENT.mrn}`);
    expect(run?.textContent).toMatch(new RegExp(`Blood ${PATIENT.bloodType.replace('+', '\\+')}$`));
    // No isolate of its own inside the run, which would detach it again.
    expect(run?.querySelector('[dir]')).toBeNull();
  });
});
