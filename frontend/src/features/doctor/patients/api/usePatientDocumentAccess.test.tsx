import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/app/providers/ToastProvider';

import type { PatientDocument } from '../model/profile-types';
import { patientDocumentsService } from '../service';

import { usePatientDocumentAccess } from './usePatientDocumentAccess';
import { patientKeys } from './usePatientsQuery';

/**
 * D-04, the half the tab cannot prove.
 *
 * `DocumentsTab.test.tsx` asserts that no control is offered while storage
 * is unconfigured. That is necessary and not sufficient: the export call
 * this replaced lived in the page, one layer below the buttons, and a tab
 * with no buttons sitting on a hook that still fabricates a file is the
 * same defect with a tidier surface. So this drives the real hook against
 * the real service and watches the one thing that ends with a file on
 * disk — an anchor with an `href`.
 */

const DOCUMENT: PatientDocument = {
  id: 'PT-1001-doc-0',
  name: 'Referral letter — cardiology.pdf',
  category: 'referral',
  uploadedAt: '2026-03-04T13:45:00.000Z',
  uploadedBy: 'Dr. Amelia Chen',
  sizeKb: 820,
};

let anchors: HTMLAnchorElement[] = [];

beforeEach(() => {
  anchors = [];
  const real = window.document.createElement.bind(window.document);
  vi.spyOn(window.document, 'createElement').mockImplementation((tag: string) => {
    const element = real(tag);
    if (tag === 'a') anchors.push(element as HTMLAnchorElement);
    return element;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

describe('reading a stored patient document', () => {
  it('reports the deployment’s storage state rather than assuming one', async () => {
    const { result } = renderHook(() => usePatientDocumentAccess('PT-1001'), { wrapper });

    expect(result.current.storage).toBeUndefined();
    await waitFor(() => {
      expect(result.current.storage).toBe('unconfigured');
    });
  });

  it('downloads nothing and says so, instead of exporting a stand-in', async () => {
    const { result } = renderHook(() => usePatientDocumentAccess('PT-1001'), { wrapper });

    await act(async () => {
      result.current.download(DOCUMENT);
      result.current.view(DOCUMENT);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.pendingId).toBeNull();
    });

    // The whole point: the referral letter's filename never reaches a file.
    expect(anchors.filter((anchor) => anchor.getAttribute('href') !== null)).toHaveLength(0);

    // And the refusal is shown rather than swallowed — one error toast per
    // attempt, persisting until dismissed (DS §8.23), carrying the
    // service's own reason and naming the file that was not opened.
    const refusals = await screen.findAllByText(/no document service is connected/i);
    expect(refusals).toHaveLength(2);
    expect(
      screen.getAllByText('Referral letter — cardiology.pdf could not be opened'),
    ).toHaveLength(2);
  });
});

describe('the live paths, through the service', () => {
  it('asks for the document through its chart, and follows the signed URL', async () => {
    const resolve = vi
      .spyOn(patientDocumentsService, 'resolve')
      .mockResolvedValue({
        kind: 'ready',
        url: 'https://store.example/signed',
        expiresInSeconds: 300,
      });
    const { result } = renderHook(() => usePatientDocumentAccess('PT-1001'), { wrapper });

    act(() => {
      result.current.download(DOCUMENT);
    });

    await waitFor(() => {
      expect(result.current.pendingId).toBeNull();
    });
    expect(resolve).toHaveBeenCalledWith('PT-1001', 'PT-1001-doc-0');
    const followed = anchors.filter((anchor) => anchor.getAttribute('href') !== null);
    expect(followed).toHaveLength(1);
    expect(followed[0]?.href).toBe('https://store.example/signed');
    expect(followed[0]?.download).toBe('Referral letter — cardiology.pdf');
  });

  it('refetches the Documents tab once an upload is filed, then announces it', async () => {
    vi.spyOn(patientDocumentsService, 'upload').mockResolvedValue({
      kind: 'stored',
      document: DOCUMENT,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePatientDocumentAccess('PT-1001'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    });

    let filed: PatientDocument | null = null;
    await act(async () => {
      filed = await result.current.upload({
        patientId: 'PT-1001',
        file: new File(['x'], 'consent.pdf', { type: 'application/pdf' }),
        category: 'consent',
      });
    });

    expect(filed).toEqual(DOCUMENT);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [...patientKeys.detail('PT-1001'), 'tab', 'documents'],
    });
    expect(await screen.findByText('consent.pdf uploaded')).toBeInTheDocument();
  });

  it('refetches nothing and announces no success when the upload is refused', async () => {
    vi.spyOn(patientDocumentsService, 'upload').mockResolvedValue({
      kind: 'rejected',
      reason: 'application/zip is not accepted for patient_document',
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePatientDocumentAccess('PT-1001'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      ),
    });

    let filed: PatientDocument | null = DOCUMENT;
    await act(async () => {
      filed = await result.current.upload({
        patientId: 'PT-1001',
        file: new File(['x'], 'archive.zip', { type: 'application/zip' }),
        category: 'report',
      });
    });

    expect(filed).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
    expect(
      await screen.findByText('application/zip is not accepted for patient_document'),
    ).toBeInTheDocument();
    expect(screen.queryByText('archive.zip uploaded')).not.toBeInTheDocument();
  });
});
