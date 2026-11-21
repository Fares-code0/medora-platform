import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';
import { json, envelope, stubApi } from '@/test/api-stub';

import {
  httpMaskedDirectoryService,
  maskedDirectoryService,
  mockMaskedDirectoryService,
} from './masked-directory';
import { MaskedDirectoryPage } from './MaskedDirectoryPage';

/**
 * The staff patient directory (DEC-006a): the server's masked projection,
 * read-only, never unmasked by the client.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MASKED_ROW = {
  patientId: 'PT-1001',
  name: 'K**** N*****',
  mrn: '***-1001',
  phone: '+20 *** *** 4567',
  dateOfBirth: '****-**-14',
  revealed: false,
};

function pageBody(items: readonly unknown[]) {
  return envelope({ items, page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 });
}

describe('httpMaskedDirectoryService', () => {
  it('reads GET /patients with the search and page, and keeps the masked values as sent', async () => {
    const { requests } = stubApi({ 'GET /patients': () => json(pageBody([MASKED_ROW])) });

    const result = await httpMaskedDirectoryService.list({ q: ' nassar ', page: 1 });

    expect(requests[0]?.query.get('q')).toBe('nassar');
    expect(requests[0]?.query.get('page')).toBe('1');
    expect(result.items).toEqual([
      {
        patientId: 'PT-1001',
        name: 'K**** N*****',
        mrn: '***-1001',
        phone: '+20 *** *** 4567',
        dateOfBirth: '****-**-14',
      },
    ]);
  });

  it('refuses a row that is not marked masked, rather than showing a clear identity', async () => {
    stubApi({
      'GET /patients': () => json(pageBody([{ ...MASKED_ROW, name: 'Khaled Nassar', revealed: true }])),
    });

    await expect(httpMaskedDirectoryService.list({ q: '', page: 1 })).rejects.toThrow();
  });

  it('sends no q when the search is empty', async () => {
    const { requests } = stubApi({ 'GET /patients': () => json(pageBody([])) });

    await httpMaskedDirectoryService.list({ q: '   ', page: 1 });

    expect(requests[0]?.query.has('q')).toBe(false);
  });
});

describe('mockMaskedDirectoryService', () => {
  it('never returns a clear name or MRN from the seeded roster', async () => {
    const { items } = await mockMaskedDirectoryService.list({ q: '', page: 1 });

    for (const row of items) {
      const seeded = MOCK_PATIENTS.find((patient) => patient.id === row.patientId);
      expect(seeded).toBeDefined();
      expect(row.name).not.toBe(seeded?.name);
      expect(row.mrn).not.toBe(seeded?.mrn);
    }
  });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MaskedDirectoryPage />
    </QueryClientProvider>,
  );
}

describe('MaskedDirectoryPage', () => {
  it('says identifiers are masked and lists the masked rows', async () => {
    renderPage();

    expect(screen.getByText('Identifiers are masked')).toBeInTheDocument();
    const first = MOCK_PATIENTS[0];
    expect(await screen.findByText(first?.id ?? '', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(first?.name ?? '')).not.toBeInTheDocument();
  });

  it('says when a search matches nobody', async () => {
    renderPage();
    await screen.findByText(MOCK_PATIENTS[0]?.id ?? '', undefined, { timeout: 5000 });

    await userEvent.type(screen.getByLabelText('Search patients'), 'zzzz-no-such-patient');

    expect(
      await screen.findByText('No patients match this search', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('shows a failed load as an error with a retry, never as an empty directory', async () => {
    vi.spyOn(maskedDirectoryService, 'list').mockRejectedValue(new Error('boom'));
    renderPage();

    expect(
      await screen.findByText("Couldn't load the patient directory", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText('No patients registered')).not.toBeInTheDocument();
  });
});
