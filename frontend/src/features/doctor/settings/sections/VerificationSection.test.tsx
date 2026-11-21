import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VerificationSubmitError } from '../model/settings-service';
import type { VerificationDocument } from '../model/types';
import { settingsService } from '../service';

import { VerificationSection } from './VerificationSection';

/**
 * NEW-46 — the doctor's verification documents in Settings. What is pinned
 * here is what the section claims: each document's decision in words, the
 * reviewer's reason on a rejection, which required kinds are still missing,
 * and a submission reported as "submitted for review" only once the service
 * has answered — never as verified, and never when it refused.
 */

const providers = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'Amelia Chen' } }),
  useToast: () => ({ toast: providers.toast }),
}));

function doc(overrides: Partial<VerificationDocument>): VerificationDocument {
  return {
    id: 'vd-1',
    kind: 'medical_license',
    fileId: 'f-1',
    uploadedAt: '2026-11-10T09:00:00.000Z',
    expiresOn: null,
    decision: 'pending',
    decidedAt: null,
    rejectReason: null,
    checks: { authentic: false, current: false, identityMatch: false },
    ...overrides,
  };
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <VerificationSection />
    </QueryClientProvider>,
  );
}

function pdf(): File {
  return new File(['%PDF-1.7'], 'licence.pdf', { type: 'application/pdf' });
}

async function chooseKind(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: /Document type/ }));
  await user.click(await screen.findByRole('option', { name: label }));
}

beforeEach(() => {
  providers.toast.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the expiry line', () => {
  // `expiresOn` arrives as the expiry day's local midnight (`readOptionalDay`).
  const NOW = new Date(2026, 10, 15, 14, 30);

  async function expiryLineFor(expiresOn: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([doc({ expiresOn })]);
    renderSection();
    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
    vi.useRealTimers();
    return row.textContent ?? '';
  }

  it('reads a document as valid through the whole of its expiry day', async () => {
    expect(await expiryLineFor('2026-11-15T00:00:00')).toContain('Expires');
  });

  it('reads it as expired from the next day', async () => {
    expect(await expiryLineFor('2026-11-14T00:00:00')).toContain('Expired');
  });
});

describe('what the section promises', () => {
  it('never says approval alone verifies the account', async () => {
    vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([]);
    renderSection();

    expect(
      await screen.findByText(/can complete your verification once the medical licence/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is verified once/)).not.toBeInTheDocument();
  });
});

describe('the filed documents', () => {
  it('shows each document’s decision in words, and a rejected one’s reason', async () => {
    vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([
      doc({
        id: 'vd-3',
        kind: 'national_id',
        decision: 'rejected',
        rejectReason: 'Unreadable scan.',
      }),
      doc({ id: 'vd-2', kind: 'degree_certificate', decision: 'pending' }),
      doc({
        id: 'vd-1',
        kind: 'medical_license',
        decision: 'approved',
        expiresOn: '2099-06-30T00:00:00',
      }),
    ]);
    renderSection();

    const list = await screen.findByRole('list', { name: 'Submitted documents' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('Identity document')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Rejected')).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText('Reviewer’s reason: Unreadable scan.'),
    ).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Awaiting review')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Approved')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText(/Expires/)).toBeInTheDocument();

    // A rejected national ID cannot be approved: it is still needed.
    expect(screen.getByText('Still needed: Identity document.')).toBeInTheDocument();
  });

  it('says when all three required documents are on file', async () => {
    vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([
      doc({ id: 'vd-1', kind: 'medical_license' }),
      doc({ id: 'vd-2', kind: 'degree_certificate', decision: 'approved' }),
      doc({ id: 'vd-3', kind: 'national_id' }),
    ]);
    renderSection();

    expect(
      await screen.findByText('All three required documents have been submitted.'),
    ).toBeInTheDocument();
  });

  it('shows an empty state, and every required kind as missing', async () => {
    vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText('No documents submitted yet')).toBeInTheDocument();
    expect(
      screen.getByText('Still needed: Medical licence, Degree certificate, Identity document.'),
    ).toBeInTheDocument();
  });

  it('offers Retry when the list cannot be read, and shows it once it can', async () => {
    const list = vi
      .spyOn(settingsService, 'listVerificationDocuments')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([doc({ kind: 'medical_license' })]);
    renderSection();

    expect(
      await screen.findByText("Couldn't load your verification documents"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Medical licence')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('submitting a document', () => {
  it('keeps Submit disabled until a type and a file are chosen', async () => {
    vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([]);
    const submit = vi.spyOn(settingsService, 'submitVerificationDocument');
    const user = userEvent.setup();
    renderSection();

    const button = screen.getByRole('button', { name: 'Submit for review' });
    expect(button).toBeDisabled();

    await user.upload(screen.getByLabelText(/^File/), pdf());
    expect(button).toBeDisabled();

    await chooseKind(user, 'Medical licence');
    expect(button).toBeEnabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits the file, kind and expiry, re-reads the list, and says it is pending review', async () => {
    const list = vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([]);
    const submit = vi
      .spyOn(settingsService, 'submitVerificationDocument')
      .mockResolvedValue(doc({ kind: 'medical_license' }));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText('No documents submitted yet');

    const file = pdf();
    await chooseKind(user, 'Medical licence');
    await user.upload(screen.getByLabelText(/^File/), file);
    fireEvent.change(screen.getByLabelText(/Expiry date/), { target: { value: '2028-06-30' } });
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith('u-1', {
      file,
      kind: 'medical_license',
      expiresOn: '2028-06-30',
    });
    await waitFor(() =>
      expect(providers.toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success', title: 'Document submitted' }),
      ),
    );
    const [toast] = providers.toast.mock.calls[0] as [{ title: string; description: string }];
    expect(toast.description).toMatch(/submitted for review/i);
    expect(`${toast.title} ${toast.description}`).not.toMatch(/verified/i);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    // The form is cleared for the next document.
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  });

  it('shows the refusal in the service’s words, and announces no success', async () => {
    vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([]);
    vi.spyOn(settingsService, 'submitVerificationDocument').mockRejectedValue(
      new VerificationSubmitError(
        'No file storage is connected to this deployment, so documents cannot be uploaded yet.',
      ),
    );
    const user = userEvent.setup();
    renderSection();

    await chooseKind(user, 'Identity document');
    await user.upload(screen.getByLabelText(/^File/), pdf());
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Document not submitted');
    expect(alert).toHaveTextContent(
      'No file storage is connected to this deployment, so documents cannot be uploaded yet.',
    );
    expect(providers.toast).not.toHaveBeenCalled();
    // The choices stay, so the doctor can try again without re-entering them.
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  });

  it('says nothing was submitted on any other failure', async () => {
    vi.spyOn(settingsService, 'listVerificationDocuments').mockResolvedValue([]);
    vi.spyOn(settingsService, 'submitVerificationDocument').mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderSection();

    await chooseKind(user, 'Other supporting document');
    await user.upload(screen.getByLabelText(/^File/), pdf());
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing was submitted. Please try again.',
    );
  });
});
