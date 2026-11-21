import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';
import { AppProviders } from '@/app/providers';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { __resetMockProfileWrites } from '../../mock/mock-profile-service';
import { canActOnNote } from '../../model/profile-service';
import type { ClinicalNote } from '../../model/profile-types';
import { PatientProfilePage } from '../../pages/PatientProfilePage';
import { patientProfileService } from '../../service';

/**
 * Chart notes, DEC-001: written unsigned, corrected until signed, frozen once
 * signed. Edit and Sign are offered only on the signed-in user's own unsigned
 * notes; the server refuses anyone else (BR-DEC-001, 403 `not_note_author`),
 * and the chart names that refusal instead of inviting a retry.
 */

const ME = { id: 'usr_doctor_amelia', name: 'Dr. Amelia Chen' };

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useAuth: () => {
      const real = actual.useAuth();
      return {
        ...real,
        user: {
          id: 'usr_doctor_amelia',
          name: 'Dr. Amelia Chen',
          email: 'doctor@medora.health',
          role: 'doctor' as const,
          permissions: real.user?.permissions ?? [],
        },
      };
    },
  };
});

const LOAD = { timeout: 10_000 };
const CASE_TIMEOUT = 30_000;
const PATIENT_ID = MOCK_PATIENTS[2]?.id ?? '';

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
  __resetMockProfileWrites();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderNotes() {
  return render(
    <MemoryRouter initialEntries={[`/doctor/patients/${PATIENT_ID}?tab=notes`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/patients/:patientId" element={<PatientProfilePage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

const note = (overrides: Partial<ClinicalNote>): ClinicalNote => ({
  id: 'n-1',
  authorId: ME.id,
  author: ME.name,
  authoredAt: '2026-10-01T09:00:00.000Z',
  title: 'Telephone encounter',
  body: 'Reviewed results by phone.',
  signed: false,
  ...overrides,
});

describe('canActOnNote — the display rule', () => {
  it('offers actions only on the signed-in user’s own unsigned note', () => {
    expect(canActOnNote(note({}), ME.id)).toBe(true);
    expect(canActOnNote(note({ signed: true }), ME.id)).toBe(false);
    expect(canActOnNote(note({ authorId: 'usr_someone_else' }), ME.id)).toBe(false);
    expect(canActOnNote(note({}), undefined)).toBe(false);
    expect(canActOnNote(note({ authorId: '' }), '')).toBe(false);
  });

  it('compares account ids, never display names — two clinicians can share a name', () => {
    expect(canActOnNote(note({ authorId: 'usr_other_amelia', author: ME.name }), ME.id)).toBe(
      false,
    );
  });
});

describe('Chart notes on the patient record', () => {
  it(
    'offers no Edit or Sign on another clinician’s notes',
    async () => {
      renderNotes();
      await screen.findByRole('button', { name: 'Write note' }, LOAD);
      // Every seeded note is by a name with no account behind it.
      expect(screen.queryByRole('button', { name: /^Edit note:/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Sign note:/ })).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'writes a note unsigned, under the signed-in author, and refuses an empty one',
    async () => {
      const add = vi.spyOn(patientProfileService, 'addNote');
      renderNotes();
      await userEvent.click(await screen.findByRole('button', { name: 'Write note' }, LOAD));
      const dialog = await screen.findByRole('dialog', { name: 'Write a note' });

      await userEvent.click(within(dialog).getByRole('button', { name: 'Save note' }));
      expect(within(dialog).getByText('Give the note a title')).toBeInTheDocument();
      expect(add).not.toHaveBeenCalled();

      await userEvent.type(within(dialog).getByLabelText(/^Title/), 'Telephone encounter');
      await userEvent.type(within(dialog).getByLabelText(/^Note/), 'Reviewed results by phone.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save note' }));

      expect(await screen.findByText('Note saved, unsigned', undefined, LOAD)).toBeInTheDocument();
      expect(add).toHaveBeenCalledWith(
        PATIENT_ID,
        { title: 'Telephone encounter', body: 'Reviewed results by phone.' },
        ME,
      );
      expect(
        await screen.findByRole('button', { name: 'Sign note: Telephone encounter' }),
      ).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'corrects an own unsigned note, then signs it, after which neither is offered',
    async () => {
      await patientProfileService.addNote(
        PATIENT_ID,
        { title: 'Draft plan', body: 'Start low dose.' },
        ME,
      );
      renderNotes();

      await userEvent.click(
        await screen.findByRole('button', { name: 'Edit note: Draft plan' }, LOAD),
      );
      const editDialog = await screen.findByRole('dialog', { name: 'Edit note' });
      const body = within(editDialog).getByLabelText(/^Note/);
      await userEvent.clear(body);
      await userEvent.type(body, 'Start low dose; review in two weeks.');
      await userEvent.click(within(editDialog).getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByText('Note updated', undefined, LOAD)).toBeInTheDocument();
      expect(screen.getByText('Start low dose; review in two weeks.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Sign note: Draft plan' }));
      const signDialog = await screen.findByRole('alertdialog', { name: 'Sign this note?' });
      expect(within(signDialog).getByText(/cannot be edited/)).toBeInTheDocument();
      await userEvent.click(within(signDialog).getByRole('button', { name: 'Sign note' }));

      expect(await screen.findByText('Note signed', undefined, LOAD)).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Edit note: Draft plan' }),
        ).not.toBeInTheDocument();
      });
      expect(
        screen.queryByRole('button', { name: 'Sign note: Draft plan' }),
      ).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'keeps the sign dialog open and names the server’s refusal',
    async () => {
      await patientProfileService.addNote(
        PATIENT_ID,
        { title: 'Draft plan', body: 'Start low dose.' },
        ME,
      );
      vi.spyOn(patientProfileService, 'signNote').mockRejectedValue(
        Object.assign(new Error('API error: conflict'), {
          kind: 'conflict',
          detail: 'That note is already signed',
        }),
      );
      renderNotes();

      await userEvent.click(
        await screen.findByRole('button', { name: 'Sign note: Draft plan' }, LOAD),
      );
      const dialog = await screen.findByRole('alertdialog', { name: 'Sign this note?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Sign note' }));

      expect(
        await within(dialog).findByText('That note is already signed', undefined, LOAD),
      ).toBeInTheDocument();
      expect(screen.queryByText('Note signed')).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'names the author refusal and calls the sign with who is signing (BR-DEC-001)',
    async () => {
      await patientProfileService.addNote(
        PATIENT_ID,
        { title: 'Draft plan', body: 'Start low dose.' },
        ME,
      );
      const sign = vi.spyOn(patientProfileService, 'signNote').mockRejectedValue(
        Object.assign(new Error('API error: forbidden'), {
          kind: 'forbidden',
          code: 'not_note_author',
        }),
      );
      renderNotes();

      await userEvent.click(
        await screen.findByRole('button', { name: 'Sign note: Draft plan' }, LOAD),
      );
      const dialog = await screen.findByRole('alertdialog', { name: 'Sign this note?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Sign note' }));

      expect(
        await within(dialog).findByText(
          'Only the note’s author can edit or sign it. Nothing was changed.',
          undefined,
          LOAD,
        ),
      ).toBeInTheDocument();
      expect(within(dialog).queryByText(/try again/i)).not.toBeInTheDocument();
      expect(sign).toHaveBeenCalledWith(PATIENT_ID, expect.any(String), {
        id: ME.id,
        name: ME.name,
      });
    },
    CASE_TIMEOUT,
  );
});
