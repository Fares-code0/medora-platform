import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { __resetRecordsStore } from '../mock/mock-record-service';
import { emptyDraft, isDraftComplete, withDiagnosisAdded } from '../model/authoring';
import type { CompleteRecordDraft } from '../model/authoring';
import { recordService } from '../service';

import { MedicalRecordDetailPage } from './MedicalRecordDetailPage';

/**
 * Signing and amending on the record itself (D-21).
 *
 * Two properties carry the weight: a note you did not write offers no Sign
 * control at all, and an addendum leaves every signed note byte-for-byte
 * intact rather than replacing one.
 *
 * `DEFAULT_DOCTOR_PROFILE.fullName` is 'Doctor' with no signed-in user, and
 * that is the author the flow records — so the fixtures author under the same
 * name the page will compare against.
 */

const LOAD = { timeout: 10_000 };
const CASE_TIMEOUT = 30_000;
const ME = 'Doctor';

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  __resetRecordsStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function completeDraft(): CompleteRecordDraft {
  const draft = {
    ...emptyDraft('draft-1', '2026-08-01T09:00:00.000Z'),
    patient: {
      id: 'PT-1001',
      name: 'Khaled Nassar',
      mrn: 'MRN-1',
      age: 52,
      gender: 'male' as const,
      bloodType: 'O+' as const,
      phone: '01000000000',
    },
    visit: { visitDate: '2026-08-01', visitType: 'Follow-up', department: 'General Medicine' },
    chiefComplaint: 'Routine review',
    historyOfPresentIllness: 'Stable since the last visit.',
    physicalExamination: 'No new findings.',
    diagnoses: withDiagnosisAdded([], 'I10'),
    note: { title: 'Consultation note', body: 'Reviewed; plan unchanged.' },
  };
  if (!isDraftComplete(draft)) throw new Error('fixture is not complete');
  return draft;
}

function renderDetail(recordId: string) {
  return render(
    <MemoryRouter initialEntries={[`/doctor/medical-records/${recordId}`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/medical-records/:recordId" element={<MedicalRecordDetailPage />} />
          <Route path="/doctor/medical-records" element={<h1>Records</h1>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('signing a note', () => {
  it('offers Sign on an unsigned note of your own, and records the signature', async () => {
    const user = userEvent.setup();
    const created = await recordService.createRecord(completeDraft(), ME);
    renderDetail(created.id);

    await user.click(
      await screen.findByRole('button', { name: /Sign the note "Consultation note"/ }, LOAD),
    );

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    // The note is shown in full: a signature attests to content.
    expect(within(dialog).getByText('Reviewed; plan unchanged.')).toBeInTheDocument();
    expect(within(dialog).getByText('Signing is not reversible')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Sign note' }));

    await waitFor(async () => {
      const after = await recordService.getRecord(created.id);
      expect(after.notes[0]?.signed).toBe(true);
      expect(after.status).toBe('active');
    }, LOAD);
  }, CASE_TIMEOUT);

  it('offers NO Sign control on a note written by someone else', async () => {
    const created = await recordService.createRecord(completeDraft(), 'Dr. Hassan Fouad');
    renderDetail(created.id);

    await screen.findByRole('heading', { name: 'Clinical notes' }, LOAD);
    // Absent, not disabled — the model refuses to produce a signable value.
    expect(
      screen.queryByRole('button', { name: /Sign the note/ }),
    ).not.toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('a failed signature leaves the note unsigned and says so', async () => {
    const user = userEvent.setup();
    const created = await recordService.createRecord(completeDraft(), ME);
    vi.spyOn(recordService, 'signNote').mockRejectedValue(new Error('Network unavailable.'));

    renderDetail(created.id);
    await user.click(
      await screen.findByRole('button', { name: /Sign the note/ }, LOAD),
    );
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Sign note' }));

    await waitFor(() => {
      expect(within(dialog).getByText(/still unsigned/i)).toBeInTheDocument();
    }, LOAD);
    await expect(recordService.getRecord(created.id)).resolves.toHaveProperty('status', 'draft');
  }, CASE_TIMEOUT);
});

describe('a signature whose outcome is unknown', () => {
  it('does not tell the doctor the note is unsigned after a lost connection', async () => {
    const user = userEvent.setup();
    const created = await recordService.createRecord(completeDraft(), ME);
    vi.spyOn(recordService, 'signNote').mockRejectedValue(
      Object.assign(new Error('API error: network'), { kind: 'network' }),
    );

    renderDetail(created.id);
    await user.click(await screen.findByRole('button', { name: /Sign the note/ }, LOAD));
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Sign note' }));

    expect(
      await within(dialog).findByText(/not known whether this was saved/i, undefined, LOAD),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/still unsigned/i)).not.toBeInTheDocument();
  }, CASE_TIMEOUT);
});

describe('what the server says', () => {
  it('a refused signature shows the server’s reason, not "API error"', async () => {
    const user = userEvent.setup();
    const created = await recordService.createRecord(completeDraft(), ME);
    vi.spyOn(recordService, 'signNote').mockRejectedValue(
      Object.assign(new Error('API error: conflict'), {
        kind: 'conflict',
        code: 'note_already_signed',
        detail: 'The note is already signed',
      }),
    );

    renderDetail(created.id);
    await user.click(await screen.findByRole('button', { name: /Sign the note/ }, LOAD));
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: 'Sign note' }));

    expect(
      await within(dialog).findByText(/The note is already signed\./, undefined, LOAD),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/API error/)).not.toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('a record with no vitals says so, rather than showing zeroes', async () => {
    const created = await recordService.createRecord(completeDraft(), ME);
    renderDetail(created.id);

    expect(
      await screen.findByText('No vital signs recorded for this visit.', undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText('0/0')).not.toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('an unknown or out-of-scope record reads as not found', async () => {
    renderDetail('MR-00000');
    expect(await screen.findByText(/not found/i, undefined, LOAD)).toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('a record without notes accepts a first one', async () => {
    const created = await recordService.createRecord(completeDraft(), ME);
    vi.spyOn(recordService, 'getRecord').mockResolvedValue({ ...created, notes: [] });
    renderDetail(created.id);

    expect(
      await screen.findByRole('button', { name: 'Add addendum' }, LOAD),
    ).toBeInTheDocument();
  }, CASE_TIMEOUT);
});

describe('amending', () => {
  it('is not offered until something on the record is signed', async () => {
    const created = await recordService.createRecord(completeDraft(), ME);
    renderDetail(created.id);

    await screen.findByRole('heading', { name: 'Clinical notes' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Add addendum' })).not.toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('appends an addendum and leaves the signed note untouched', async () => {
    const user = userEvent.setup();
    const created = await recordService.createRecord(completeDraft(), ME);
    const { signable } = (await import('../model/record-lifecycle')).assessNoteSignability({
      record: created,
      noteId: created.notes[0]!.id,
      signedBy: ME,
    });
    const signed = await recordService.signNote(signable!);
    const originalNote = signed.notes[0]!;

    renderDetail(created.id);
    await user.click(await screen.findByRole('button', { name: 'Add addendum' }, LOAD));

    const dialog = await screen.findByRole('dialog', { name: /Add an addendum/ }, LOAD);
    expect(within(dialog).getByText('Addenda append; they never replace')).toBeInTheDocument();

    await user.type(
      within(dialog).getByRole('textbox', { name: /Addendum title/ }),
      'Correction — laterality',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Addendum' }),
      'Left, not right.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add addendum' }));

    await waitFor(async () => {
      const after = await recordService.getRecord(created.id);
      expect(after.notes).toHaveLength(2);
      // The signed note is returned exactly as it was.
      expect(after.notes[0]).toEqual(originalNote);
      expect(after.notes[1]?.signed).toBe(false);
    }, LOAD);
  }, CASE_TIMEOUT);
});

describe('status', () => {
  it('offers no transition out of a draft whose note is unsigned', async () => {
    const created = await recordService.createRecord(completeDraft(), ME);
    renderDetail(created.id);

    await screen.findByRole('heading', { name: 'Clinical notes' }, LOAD);
    expect(
      screen.queryByRole('combobox', { name: 'Change record status' }),
    ).not.toBeInTheDocument();
  }, CASE_TIMEOUT);
});
