import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { labService } from '../service';

import { LabCataloguePage } from './LabCataloguePage';

/**
 * The laboratory's read-only catalogue (DEC-006a): the list, an empty
 * catalogue said as such, and a failed load said as a failure — never as an
 * empty catalogue. Nothing on the page acts on an order.
 */

const LOAD = { timeout: 5000 };

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LabCataloguePage />
    </QueryClientProvider>,
  );
}

describe('LabCataloguePage', () => {
  it('lists the catalogue and offers no order actions', async () => {
    const catalogue = await labService.listCatalogue();
    const first = catalogue[0];
    if (first === undefined) throw new Error('the demo catalogue is empty');

    renderPage();

    expect(await screen.findByText(first.name, undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(first.code)).toBeInTheDocument();
    expect(screen.getByText(/not available to laboratory accounts yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /order|result|review/i })).not.toBeInTheDocument();
  });

  it('says so when the catalogue is empty', async () => {
    vi.spyOn(labService, 'listCatalogue').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No tests in the catalogue', undefined, LOAD)).toBeInTheDocument();
  });

  it('shows a failed load as an error with a retry', async () => {
    vi.spyOn(labService, 'listCatalogue').mockRejectedValue(new Error('boom'));
    renderPage();

    expect(
      await screen.findByText("Couldn't load the test catalogue", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText('No tests in the catalogue')).not.toBeInTheDocument();
  });
});
