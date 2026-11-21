import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createMemoryRouter,
} from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { __resetRecordsStore } from '../mock/mock-record-service';
import { RECORD_NOTE_NOT_SAVED } from '../model/record-service';
import { recordService } from '../service';

import { NewMedicalRecordPage } from './NewMedicalRecordPage';

/**
 * The authoring flow end to end, in the DOM.
 *
 * The load-bearing test is the one that asserts what "Create record"
 * *produces*: a draft encounter whose note is UNSIGNED. Creating and signing
 * are two acts, and a flow that quietly signed on create would be the same
 * false-completeness this module is being fixed for.
 *
 * A data router (`createMemoryRouter`) rather than `MemoryRouter`, because
 * `useUnsavedChangesGuard` uses `useBlocker`, which only exists on one.
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

function renderFlow(search = '') {
  const router = createMemoryRouter(
    [
      { path: '/doctor/medical-records/new', element: <NewMedicalRecordPage /> },
      { path: '/doctor/medical-records/:recordId', element: <h1>Record detail</h1> },
      { path: '/doctor/medical-records', element: <h1>Records list</h1> },
    ],
    { initialEntries: [`/doctor/medical-records/new${search}`] },
  );
  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

/** Encounter → clinical, leaving the draft one step from Review. */
async function fillToClinical(user: ReturnType<typeof userEvent.setup>) {
  const date = await screen.findByLabelText(/Encounter date/, undefined, LOAD);
  await user.clear(date);
  await user.type(date, '2026-08-01');

  await user.click(screen.getByRole('combobox', { name: /Visit type/ }));
  await user.click(await screen.findByRole('option', { name: 'Follow-up' }));

  await user.click(screen.getByRole('combobox', { name: /Department/ }));
  await user.click(await screen.findByRole('option', { name: 'General Medicine' }));

  await user.type(
    screen.getByRole('textbox', { name: /Chief complaint/ }),
    'Routine review',
  );
  await user.type(
    screen.getByRole('textbox', { name: /History of present illness/ }),
    'Stable since the last visit.',
  );
  await user.type(
    screen.getByRole('textbox', { name: /Physical examination/ }),
    'No new findings.',
  );
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('the flow gates each step (D-21)', () => {
  it('opens on the patient step and will not advance without one', async () => {
    const user = userEvent.setup();
    renderFlow();

    expect(await screen.findByRole('heading', { name: 'Patient' }, LOAD)).toBeInTheDocument();
    // The roster is the patient directory, which loads first.
    await screen.findAllByRole('radio', undefined, LOAD);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Still on Patient, and now saying why.
    expect(screen.getByRole('heading', { name: 'Patient' })).toBeInTheDocument();
    expect(
      screen.getByText('Choose the patient this encounter is for.'),
    ).toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('a ?patient= deep link opens on the encounter step with the patient answered', async () => {
    renderFlow('?patient=PT-1001');
    expect(await screen.findByRole('heading', { name: 'Encounter' }, LOAD)).toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('keeps Review locked until the draft is complete', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await screen.findByRole('heading', { name: 'Encounter' }, LOAD);

    const reviewStep = screen.getByRole('button', { name: /Step 4 of 4/ });
    expect(reviewStep).toBeDisabled();

    await fillToClinical(user);
    // Clinical reached, but nothing entered on it yet.
    expect(await screen.findByRole('heading', { name: 'Clinical' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Step 4 of 4/ })).toBeDisabled();
  }, CASE_TIMEOUT);
});

describe('vitals', () => {
  it('derives the BMI rather than asking for it', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await screen.findByRole('heading', { name: 'Encounter' }, LOAD);
    await fillToClinical(user);

    expect(screen.queryByRole('spinbutton', { name: /BMI/ })).not.toBeInTheDocument();

    await user.type(screen.getByRole('spinbutton', { name: /Height/ }), '175');
    await user.type(screen.getByRole('spinbutton', { name: /Weight/ }), '80');

    await waitFor(() => {
      expect(screen.getByText('26.1')).toBeInTheDocument();
    }, LOAD);
  }, CASE_TIMEOUT);

  it('refuses a value that could only be a typo, and says which', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await screen.findByRole('heading', { name: 'Encounter' }, LOAD);
    await fillToClinical(user);

    await user.type(screen.getByRole('spinbutton', { name: /Heart rate/ }), '720');

    await waitFor(() => {
      expect(screen.getByText(/Check 1 value/)).toBeInTheDocument();
    }, LOAD);
    expect(screen.getByText(/Heart rate should be between 20 and 300 bpm/)).toBeInTheDocument();
  }, CASE_TIMEOUT);
});

describe('creating the record', () => {
  async function fillEverything(user: ReturnType<typeof userEvent.setup>) {
    renderFlow('?patient=PT-1001');
    await screen.findByRole('heading', { name: 'Encounter' }, LOAD);
    await fillToClinical(user);
    await screen.findByRole('heading', { name: 'Clinical' }, LOAD);

    await user.click(screen.getByRole('combobox', { name: /Add a diagnosis/ }));
    await user.click(await screen.findByRole('option', { name: /I10 — Essential hypertension/ }));

    await user.type(screen.getByRole('textbox', { name: /Note title/ }), 'Consultation note');
    await user.type(
      screen.getByRole('textbox', { name: 'Note' }),
      'Reviewed; plan unchanged.',
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Review & sign' }, LOAD);
  }

  it('creates a DRAFT record whose note is UNSIGNED — signing is a separate act', async () => {
    const user = userEvent.setup();
    await fillEverything(user);

    // The review step says so before the button is pressed.
    expect(screen.getByText('Will be created unsigned')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(async () => {
      const created = (await recordService.listRecords()).find((entry) =>
        entry.id.startsWith('MR-9'),
      );
      expect(created).toBeDefined();
      expect(created?.status).toBe('draft');
      const full = await recordService.getRecord(created?.id ?? '');
      expect(full.notes[0]?.signed).toBe(false);
      expect(full.historyOfPresentIllness).toBe('Stable since the last visit.');
    }, LOAD);
  }, CASE_TIMEOUT);

  it('shows no allergy warning once the patient\'s chart has been read', async () => {
    const user = userEvent.setup();
    await fillEverything(user);

    expect(screen.getByText('Will be created unsigned')).toBeInTheDocument();
    expect(screen.queryByText('Allergies could not be checked')).not.toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('a failed create leaves the draft on screen and says nothing was stored', async () => {
    const user = userEvent.setup();
    vi.spyOn(recordService, 'createRecord').mockRejectedValue(new Error('Storage unavailable.'));

    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(() => {
      expect(screen.getByText(/The record was not created/)).toBeInTheDocument();
    }, LOAD);
    // Still on Review, with the work intact.
    expect(screen.getByRole('heading', { name: 'Review & sign' })).toBeInTheDocument();
    expect(screen.getByText('Reviewed; plan unchanged.')).toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('a record created without its note says so and goes to it, rather than inviting a duplicate', async () => {
    const user = userEvent.setup();
    vi.spyOn(recordService, 'createRecord').mockRejectedValue(
      Object.assign(new Error(RECORD_NOTE_NOT_SAVED), { recordId: 'MR-10001' }),
    );

    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: 'Create record' }));

    expect(
      await screen.findByRole('heading', { name: 'Record detail' }, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByText('MR-10001 was created without its note')).toBeInTheDocument();
  }, CASE_TIMEOUT);
});

describe('the encounter step', () => {
  it('will not advance without the history and the examination', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await screen.findByRole('heading', { name: 'Encounter' }, LOAD);

    await user.type(screen.getByRole('textbox', { name: /Chief complaint/ }), 'Routine review');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Encounter' })).toBeInTheDocument();
    expect(screen.getByText('Record the history of the complaint.')).toBeInTheDocument();
    expect(screen.getByText('Record the examination findings.')).toBeInTheDocument();
  }, CASE_TIMEOUT);
});

describe('the unsaved-changes guard (UX §2.3)', () => {
  it('blocks an in-app navigation once anything has been entered', async () => {
    const user = userEvent.setup();
    renderFlow('?patient=PT-1001');
    await screen.findByRole('heading', { name: 'Encounter' }, LOAD);

    await user.type(
      screen.getByRole('textbox', { name: /Chief complaint/ }),
      'Routine review',
    );

    /*
     * Cancel navigates through the router, which is what `useBlocker` can
     * see. The breadcrumb above it is a plain anchor — a full page load —
     * and is covered by the hook's `beforeunload` half instead.
     */
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(
      within(dialog).getByText('Leave without saving this record?'),
    ).toBeInTheDocument();
  }, CASE_TIMEOUT);
});
