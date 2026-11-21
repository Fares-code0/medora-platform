import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { __resetRecordsStore } from '../mock/mock-record-service';
import {
  emptyDraft,
  isDraftComplete,
  withDiagnosisAdded,
  type CompleteRecordDraft,
} from '../model/authoring';
import { recordService } from '../service';

import { MedicalRecordDetailPage } from './MedicalRecordDetailPage';

/**
 * Editing a record (DEC-004): offered only on a draft with nothing signed;
 * sends only what changed; every edit appears in the record's edit history
 * with who, when and before/after — and the editor's reason, when one is
 * given (BR-DEC-004). A signed record offers no edit at all — corrections
 * there are addenda. An edit by anyone but the author is refused by the
 * server, and the dialog says so.
 */

const LOAD = { timeout: 10_000 };
const CASE_TIMEOUT = 30_000;

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

function renderRecord(recordId: string) {
  return render(
    <MemoryRouter initialEntries={[`/doctor/medical-records/${recordId}`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/medical-records/:recordId" element={<MedicalRecordDetailPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('Editing a draft record — DEC-004', () => {
  it(
    'saves only the change and shows it in the edit history with before and after',
    async () => {
      const update = vi.spyOn(recordService, 'updateRecord');
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      renderRecord(created.id);

      expect(
        await screen.findByText(
          'No edits recorded. The record is as it was created.',
          undefined,
          LOAD,
        ),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Edit record' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });

      // Nothing changed yet: there is nothing to save.
      expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();

      const complaint = within(dialog).getByLabelText(/^Chief complaint/);
      await userEvent.clear(complaint);
      await userEvent.type(complaint, 'Routine review, plus new cough');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(await screen.findByText(`${created.id} updated`, undefined, LOAD)).toBeInTheDocument();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ changes: { chiefComplaint: 'Routine review, plus new cough' } }),
      );
      expect(await screen.findByText(/^Version 1 ·/, undefined, LOAD)).toBeInTheDocument();
      // The before-value only survives in the history: the record itself now says the new text.
      expect(screen.getByText('Routine review')).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'keeps the dialog and names the refusal when the server will not edit',
    async () => {
      vi.spyOn(recordService, 'updateRecord').mockRejectedValue(new Error('RECORD_NOT_EDITABLE'));
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      renderRecord(created.id);

      await userEvent.click(await screen.findByRole('button', { name: 'Edit record' }, LOAD));
      const dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });
      const complaint = within(dialog).getByLabelText(/^Chief complaint/);
      await userEvent.type(complaint, ' (updated)');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(
        await within(dialog).findByText(
          'This record can no longer be edited. Add an addendum instead.',
          undefined,
          LOAD,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(`${created.id} updated`)).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'offers no edit once a note on the record is signed — corrections are addenda',
    async () => {
      const all = await recordService.listRecords();
      const signed = all.find((record) => record.status !== 'draft');
      if (signed === undefined) throw new Error('no seeded non-draft record');
      renderRecord(signed.id);

      await screen.findByRole('heading', { name: 'Edit history' }, LOAD);
      expect(screen.queryByRole('button', { name: 'Edit record' })).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'sends an optional reason and shows it with the version in the edit history (BR-DEC-004)',
    async () => {
      const update = vi.spyOn(recordService, 'updateRecord');
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      renderRecord(created.id);

      await userEvent.click(await screen.findByRole('button', { name: 'Edit record' }, LOAD));
      const dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });
      await userEvent.type(within(dialog).getByLabelText(/^Chief complaint/), ', plus new cough');
      await userEvent.type(
        within(dialog).getByLabelText(/^Reason for the change/),
        'Patient added a symptom at check-out',
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(await screen.findByText(`${created.id} updated`, undefined, LOAD)).toBeInTheDocument();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Patient added a symptom at check-out' }),
      );
      expect(
        await screen.findByText('Patient added a symptom at check-out', undefined, LOAD),
      ).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'names the server’s refusal of an edit by anyone but the author (BR-DEC-004)',
    async () => {
      vi.spyOn(recordService, 'updateRecord').mockRejectedValue(new Error('RECORD_NOT_AUTHOR'));
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      renderRecord(created.id);

      await userEvent.click(await screen.findByRole('button', { name: 'Edit record' }, LOAD));
      const dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });
      await userEvent.type(within(dialog).getByLabelText(/^Chief complaint/), ' (updated)');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(
        await within(dialog).findByText(
          'Only the doctor who wrote this record can edit it. Add an addendum to correct it.',
          undefined,
          LOAD,
        ),
      ).toBeInTheDocument();
      expect(within(dialog).queryByText(/try again/i)).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'edits the treatment plan — adds, reorders and removes steps — and the record shows it',
    async () => {
      const update = vi.spyOn(recordService, 'updateRecord');
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      renderRecord(created.id);

      expect(
        await screen.findByText('No treatment plan recorded.', undefined, LOAD),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Edit record' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });

      for (const step of ['Start lisinopril 10 mg daily', 'Recheck blood pressure', 'Discard me']) {
        await userEvent.click(within(dialog).getByRole('button', { name: 'Add step' }));
        // The new step's field takes focus, so a doctor can type straight away.
        await userEvent.keyboard(step);
      }
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove step 3' }));
      expect(within(dialog).getByRole('button', { name: 'Add step' })).toHaveFocus();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Move step 2 up' }));
      // Focus stays on the step that moved: it is first now, so on its "down".
      expect(within(dialog).getByRole('button', { name: 'Move step 1 down' })).toHaveFocus();
      expect(within(dialog).getByRole('button', { name: 'Move step 1 up' })).toBeDisabled();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(await screen.findByText(`${created.id} updated`, undefined, LOAD)).toBeInTheDocument();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: { treatmentPlan: ['Recheck blood pressure', 'Start lisinopril 10 mg daily'] },
        }),
      );
      const plan = screen.getByRole('heading', { name: 'Treatment plan' }).closest('section');
      if (plan === null) throw new Error('no plan section');
      expect(
        within(plan)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['Recheck blood pressure', 'Start lisinopril 10 mg daily']);
    },
    CASE_TIMEOUT,
  );

  it(
    'refuses a blank step and a follow-up before the visit, and sends nothing',
    async () => {
      const update = vi.spyOn(recordService, 'updateRecord');
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      renderRecord(created.id);

      await userEvent.click(await screen.findByRole('button', { name: 'Edit record' }, LOAD));
      const dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add step' }));
      fireEvent.change(within(dialog).getByLabelText(/^Follow-up date/), {
        target: { value: '2026-07-31' },
      });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(within(dialog).getByText('Write the step, or remove it')).toBeInTheDocument();
      expect(
        within(dialog).getByText('The follow-up cannot be before the visit'),
      ).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT,
  );

  it(
    'sets and then clears the follow-up date',
    async () => {
      const update = vi.spyOn(recordService, 'updateRecord');
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      renderRecord(created.id);

      await userEvent.click(await screen.findByRole('button', { name: 'Edit record' }, LOAD));
      let dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });
      fireEvent.change(within(dialog).getByLabelText(/^Follow-up date/), {
        target: { value: '2026-08-15' },
      });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByText(`${created.id} updated`, undefined, LOAD)).toBeInTheDocument();
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ changes: { followUpDate: '2026-08-15' } }),
      );
      expect(screen.queryByText('Not scheduled')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Edit record' }));
      dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });
      expect(within(dialog).getByLabelText(/^Follow-up date/)).toHaveValue('2026-08-15');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Clear follow-up' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      await vi.waitFor(() =>
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({ changes: { followUpDate: null } }),
        ),
      );
      expect(await screen.findByText('Not scheduled', undefined, LOAD)).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'shows the department without offering to change it — the server keeps the original',
    async () => {
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      renderRecord(created.id);

      await userEvent.click(await screen.findByRole('button', { name: 'Edit record' }, LOAD));
      const dialog = await screen.findByRole('dialog', { name: 'Edit draft record' });
      expect(
        within(dialog).queryByRole('combobox', { name: /Department/ }),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByText('General Medicine')).toBeInTheDocument();
      expect(within(dialog).getByText('Set when the record was created')).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'names the lists an edit replaced when the server reports them as `children`',
    async () => {
      const created = await recordService.createRecord(completeDraft(), 'Doctor');
      vi.spyOn(recordService, 'listVersions').mockResolvedValue([
        {
          version: 1,
          changedAt: '2026-10-04T17:10:00.000Z',
          actor: 'Dr. Amelia Chen',
          summary: 'Changed 2 sections: chiefComplaint, children',
          reason: null,
          changes: {
            chiefComplaint: { before: 'Headache', after: 'Headache for four days' },
            children: ['diagnoses', 'treatmentPlan'],
          },
        },
      ]);
      renderRecord(created.id);

      expect(await screen.findByText('Lists replaced', undefined, LOAD)).toBeInTheDocument();
      expect(screen.getByText('Diagnoses, Treatment plan')).toBeInTheDocument();
      expect(screen.queryByText('children')).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );
});
