import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import * as exporter from '@/utils/export';

import { DEFAULT_FILTERS, type AnalyticsSnapshot } from '../model/types';
import { reportsService } from '../service';

import { ExportDialog } from './ExportDialog';

/**
 * D-25 — the report export reports only what it did.
 *
 * The header's Export button is enabled while the analytics load and after
 * they fail, and the dialog used to answer "Exported as CSV" there with no
 * file written: `runExport` was skipped without a snapshot, the toast was
 * not. A refused export said nothing at all.
 */

const LOAD = { timeout: 10_000 };

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => vi.restoreAllMocks());

async function snapshot(): Promise<AnalyticsSnapshot> {
  return (await reportsService.fetchAnalytics(DEFAULT_FILTERS)).snapshot;
}

function renderDialog(data: AnalyticsSnapshot | undefined, onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <AppProviders>
        <ExportDialog open onClose={onClose} snapshot={data} />
      </AppProviders>
    </MemoryRouter>,
  );
  return screen.getByRole('dialog', { name: 'Export report' });
}

describe('ExportDialog', () => {
  it('offers nothing to export before the analytics load, and says why', async () => {
    const exportSpy = vi.spyOn(reportsService, 'runExport');
    const fileSpy = vi.spyOn(exporter, 'runExport').mockImplementation(() => undefined);
    const dialog = renderDialog(undefined);

    const button = within(dialog).getByRole('button', { name: 'Export' });
    expect(button).toBeDisabled();
    expect(within(dialog).getByText(/nothing to export yet/)).toBeInTheDocument();
    await userEvent.click(button);
    expect(exportSpy).not.toHaveBeenCalled();
    expect(fileSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Exported as/)).not.toBeInTheDocument();
  });

  it('writes the file, then announces it', async () => {
    vi.spyOn(reportsService, 'runExport').mockResolvedValue({ format: 'csv' });
    const fileSpy = vi.spyOn(exporter, 'runExport').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const dialog = renderDialog(await snapshot(), onClose);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('Exported as CSV', undefined, LOAD)).toBeInTheDocument();
    expect(fileSpy).toHaveBeenCalledWith(
      'csv',
      expect.objectContaining({ filename: 'medora-report' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a refused export, claims no file, and stays open', async () => {
    vi.spyOn(reportsService, 'runExport').mockRejectedValue(new Error('renderer down'));
    const fileSpy = vi.spyOn(exporter, 'runExport').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const dialog = renderDialog(await snapshot(), onClose);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('Export failed', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('No file was created. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/Exported as/)).not.toBeInTheDocument();
    expect(fileSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('exposes which format is chosen, not only by a decorative tick', async () => {
    const dialog = renderDialog(await snapshot());

    const csv = within(dialog).getByRole('button', { name: /^CSV/ });
    const pdf = within(dialog).getByRole('button', { name: /^PDF/ });
    expect(csv).toHaveAttribute('aria-pressed', 'true');
    expect(pdf).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(pdf);
    await waitFor(() => expect(pdf).toHaveAttribute('aria-pressed', 'true'));
    expect(csv).toHaveAttribute('aria-pressed', 'false');
  });
});
