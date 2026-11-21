import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PatientDocumentAccess } from '../../api/usePatientDocumentAccess';
import type { PatientDocument } from '../../model/profile-types';

import { DocumentsTab } from './DocumentsTab';

/**
 * D-04. What is asserted here is mostly a *negative*: that pressing nothing
 * and pressing everything both fail to produce a file while no document
 * service is connected.
 *
 * The defect this replaces was not a missing feature — the buttons worked.
 * They ran the patient's name through the PDF exporter and downloaded the
 * result under the document's own filename, so the doctor was handed a
 * plausible-looking "Referral letter — cardiology.pdf" containing three
 * fields and no referral. A test that only checked "the button is gone"
 * would pass against a version that greys it out and still exports on
 * Enter, so the anchor-creation path is spied on instead: the assertion is
 * that no download is started, by any route.
 */

// jsdom has no `<dialog>` modal API; the upload dialog is a `Modal`.
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

const DOCUMENTS: readonly PatientDocument[] = [
  {
    id: 'PT-1001-doc-0',
    name: 'Referral letter — cardiology.pdf',
    category: 'referral',
    uploadedAt: '2026-03-04T13:45:00.000Z',
    uploadedBy: 'Dr. Amelia Chen',
    sizeKb: 820,
  },
  {
    id: 'PT-1001-doc-1',
    name: 'Signed consent form.pdf',
    category: 'consent',
    uploadedAt: '2026-01-19T13:45:00.000Z',
    uploadedBy: 'Front desk',
    sizeKb: 2400,
  },
];

function access(overrides: Partial<PatientDocumentAccess> = {}): PatientDocumentAccess {
  return {
    storage: 'unconfigured',
    pendingId: null,
    view: vi.fn(),
    download: vi.fn(),
    uploading: false,
    upload: vi.fn(() => Promise.resolve(null)),
    ...overrides,
  };
}

/** Counts every anchor the tree creates, which is how a download starts. */
function watchAnchors() {
  const created: HTMLAnchorElement[] = [];
  const real = window.document.createElement.bind(window.document);
  vi.spyOn(window.document, 'createElement').mockImplementation((tag: string) => {
    const element = real(tag);
    if (tag === 'a') created.push(element as HTMLAnchorElement);
    return element;
  });
  return created;
}

describe('the Documents tab with no document service connected', () => {
  it('still lists the documents on file', () => {
    render(<DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access()} />);

    expect(screen.getByText('Referral letter — cardiology.pdf')).toBeInTheDocument();
    expect(screen.getByText('Signed consent form.pdf')).toBeInTheDocument();
    expect(screen.getByText('820 KB')).toBeInTheDocument();
  });

  it('says why the files cannot be opened, in the service’s own words', () => {
    render(<DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access()} />);

    expect(screen.getByRole('status')).toHaveTextContent(/no document service is connected/i);
  });

  it('offers no view or download control at all', () => {
    render(<DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access()} />);

    expect(screen.queryByRole('button', { name: /view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('starts no download from any control on the tab', async () => {
    const anchors = watchAnchors();
    render(<DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access()} />);

    for (const control of screen.queryAllByRole('button')) {
      await userEvent.click(control);
    }

    expect(anchors.filter((anchor) => anchor.href !== '')).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('shows no notice before the storage indicator has answered', () => {
    render(<DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access({ storage: undefined })} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view/i })).not.toBeInTheDocument();
  });
});

describe('the Documents tab with a document service connected', () => {
  const connected = { storage: 'available' } as const;

  it('drops the notice and offers both actions per row', () => {
    render(<DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access(connected)} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /view/i })).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Download Referral letter — cardiology.pdf' }),
    ).toBeInTheDocument();
  });

  it('asks the service for the document that was pressed', async () => {
    const view = vi.fn();
    const download = vi.fn();
    render(<DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access({ ...connected, view, download })} />);

    await userEvent.click(screen.getAllByRole('button', { name: /view/i })[0]!);
    await userEvent.click(
      screen.getByRole('button', { name: 'Download Signed consent form.pdf' }),
    );

    expect(view).toHaveBeenCalledWith(DOCUMENTS[0]);
    expect(download).toHaveBeenCalledWith(DOCUMENTS[1]);
  });
});

describe('uploading a document (D-04b)', () => {
  it('offers no upload control while no store is connected', () => {
    // Same rule as view/download: a button that invites a doctor to hand
    // over a consent form the app will drop is worse than no button.
    render(<DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access()} />);

    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument();
  });

  it('offers it once storage answers available', () => {
    render(
      <DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access({ storage: "available" })} />,
    );

    expect(screen.getByRole('button', { name: /upload document/i })).toBeInTheDocument();
  });

  /** Opens the dialog, and returns it with the dialog's hidden file input. */
  async function openUpload(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /upload document/i }));
    const dialog = await screen.findByRole('dialog', { name: /upload document/i });
    const input = window.document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    return { dialog, input: input as HTMLInputElement };
  }

  it('sends the chosen file and category to the service against this patient', async () => {
    const user = userEvent.setup();
    const upload = vi.fn<PatientDocumentAccess['upload']>(() => Promise.resolve(null));
    render(
      <DocumentsTab
        documents={DOCUMENTS}
        patientId="PT-1001"
        access={access({ storage: 'available', upload })}
      />,
    );

    const { dialog, input } = await openUpload(user);
    const file = new File(['x'], 'consent.pdf', { type: 'application/pdf' });
    await user.click(within(dialog).getByRole('combobox', { name: /Category/ }));
    await user.click(await screen.findByRole('option', { name: 'Consent' }));
    await user.upload(input, file);
    expect(within(dialog).getByText('consent.pdf')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0]).toEqual({ patientId: 'PT-1001', file, category: 'consent' });
  });

  it('files nothing until a category is chosen — there is no default', async () => {
    // A pre-selected "Referral" would file every consent form as a referral
    // whenever nobody changed it.
    const user = userEvent.setup();
    const upload = vi.fn<PatientDocumentAccess['upload']>(() => Promise.resolve(null));
    render(
      <DocumentsTab
        documents={DOCUMENTS}
        patientId="PT-1001"
        access={access({ storage: 'available', upload })}
      />,
    );

    const { dialog, input } = await openUpload(user);
    await user.upload(input, new File(['x'], 'consent.pdf', { type: 'application/pdf' }));
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));

    expect(upload).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Choose what kind of document this is')).toBeInTheDocument();
  });

  it('files nothing without a file', async () => {
    const user = userEvent.setup();
    const upload = vi.fn<PatientDocumentAccess['upload']>(() => Promise.resolve(null));
    render(
      <DocumentsTab
        documents={DOCUMENTS}
        patientId="PT-1001"
        access={access({ storage: 'available', upload })}
      />,
    );

    const { dialog } = await openUpload(user);
    await user.click(within(dialog).getByRole('combobox', { name: /Category/ }));
    await user.click(await screen.findByRole('option', { name: 'Insurance' }));
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));

    expect(upload).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Choose a file to upload')).toBeInTheDocument();
  });

  it('stays open on a refusal and closes once the file is filed', async () => {
    const user = userEvent.setup();
    const upload = vi
      .fn<PatientDocumentAccess['upload']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(DOCUMENTS[1] ?? null);
    render(
      <DocumentsTab
        documents={DOCUMENTS}
        patientId="PT-1001"
        access={access({ storage: 'available', upload })}
      />,
    );

    const { dialog, input } = await openUpload(user);
    await user.click(within(dialog).getByRole('combobox', { name: /Category/ }));
    await user.click(await screen.findByRole('option', { name: 'Consent' }));
    await user.upload(input, new File(['x'], 'consent.pdf', { type: 'application/pdf' }));

    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(screen.getByRole('dialog', { name: /upload document/i })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /upload document/i })).not.toBeInTheDocument();
    });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('clears the input so the same file can be picked twice', async () => {
    const user = userEvent.setup();
    render(
      <DocumentsTab documents={DOCUMENTS} patientId="PT-1001" access={access({ storage: 'available' })} />,
    );

    const { dialog, input } = await openUpload(user);
    await user.upload(input, new File(['x'], 'first.pdf', { type: 'application/pdf' }));
    await user.upload(input, new File(['y'], 'second.pdf', { type: 'application/pdf' }));

    // Without the reset a repeated pick is a no-op change event, and a
    // doctor retrying a refused upload gets silence.
    expect(input.value).toBe('');
    expect(within(dialog).getByText('second.pdf')).toBeInTheDocument();
  });
});
