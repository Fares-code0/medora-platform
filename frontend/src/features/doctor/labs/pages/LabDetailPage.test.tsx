import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import {
  __resetRecordAttachments,
  listAttachmentsForLab,
} from '@/features/shared-domain/record-attachments';
import * as attachmentStore from '@/features/shared-domain/record-attachments/store';

import { __resetLabsStore } from '../mock/mock-lab-service';
import { criticalResults } from '../model/review';
import { labService } from '../service';

import { LabDetailPage } from './LabDetailPage';

/**
 * The result page's three writes end to end (D-11, D-13, D-14).
 *
 * The load-bearing test is the attach one: it asserts the report lands in the
 * shared store the *medical record* reads, not in a labs-local list. That is
 * the difference between an attachment and a message saying there is one.
 */

const LOAD = { timeout: 10_000 };
const CASE_TIMEOUT = 20_000;

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
  __resetLabsStore();
  __resetRecordAttachments();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderDetail(labId: string) {
  return render(
    <MemoryRouter initialEntries={[`/doctor/labs/${labId}`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/labs/:labId" element={<LabDetailPage />} />
          <Route path="/doctor/labs" element={<h1>Labs</h1>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

/** Omar Farouk's critical potassium — the canonical unreviewed result. */
async function criticalTest() {
  const all = await labService.listLabTests();
  const test = all.find((entry) => entry.review === null && entry.hasCriticalResult);
  expect(test).toBeDefined();
  return test!;
}

describe('review status on the result (D-11)', () => {
  it('says the result is awaiting review and how many critical values it carries', async () => {
    const test = await criticalTest();
    renderDetail(test.id);

    const heading = await screen.findByRole('heading', { name: 'Review' }, LOAD);
    expect(heading).toBeInTheDocument();
    expect(
      screen.getByText(
        `Awaiting review — ${String(criticalResults(test).length)} critical value${
          criticalResults(test).length === 1 ? '' : 's'
        }`,
      ),
    ).toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('records the reviewer and the note, and shows both afterwards', async () => {
    const user = userEvent.setup();
    const test = await criticalTest();
    renderDetail(test.id);

    await user.click(await screen.findByRole('button', { name: 'Mark reviewed' }, LOAD));
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    for (const box of within(dialog).getAllByRole('checkbox')) {
      await user.click(box);
    }
    await user.type(
      within(dialog).getByRole('textbox', { name: /What was done about it/ }),
      'Patient admitted for monitoring.',
    );
    await user.click(within(dialog).getByRole('button', { name: /Acknowledge & mark reviewed/ }));

    /*
     * Waited on the disappearance of the call to action rather than on the
     * note text: `getByText` also matches a <textarea>'s value in jsdom, so
     * waiting for the note resolved the moment it was TYPED and asserted
     * against a page the write had not reached yet.
     */
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
      },
      LOAD,
    );

    const stored = await labService.getLabTest(test.id);
    expect(stored.review?.note).toBe('Patient admitted for monitoring.');
    expect(stored.review?.acknowledgedCriticalIds).toHaveLength(criticalResults(test).length);

    // And the page reads it back: attribution and the note, in the section.
    const section = screen.getByRole('heading', { name: 'Review' }).closest('section');
    expect(within(section!).getByText('Reviewed by')).toBeInTheDocument();
    expect(within(section!).getByText('What was done')).toBeInTheDocument();
  }, CASE_TIMEOUT);
});

describe('the analyte trend (D-13)', () => {
  it('opens from the analyte row and plots that patient’s history', async () => {
    const user = userEvent.setup();
    const test = await criticalTest();
    renderDetail(test.id);

    await user.click(
      await screen.findByRole('button', { name: 'View the trend for Potassium' }, LOAD),
    );

    const drawer = await screen.findByRole('dialog', undefined, LOAD);
    expect(
      await within(drawer).findByRole('img', { name: /Potassium over time/ }, LOAD),
    ).toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('offers a table equivalent of the chart (P6)', async () => {
    const user = userEvent.setup();
    const test = await criticalTest();
    renderDetail(test.id);

    await user.click(
      await screen.findByRole('button', { name: 'View the trend for Potassium' }, LOAD),
    );
    const drawer = await screen.findByRole('dialog', undefined, LOAD);
    await user.click(await within(drawer).findByRole('button', { name: 'View as table' }, LOAD));

    const table = within(drawer).getByRole('table');
    // The seeded series ends at the critical value the dashboard names.
    expect(within(table).getByText('6.1')).toBeInTheDocument();
    expect(within(table).getAllByText('Critical high').length).toBeGreaterThan(0);
  }, CASE_TIMEOUT);
});

describe('attach to record (D-14)', () => {
  it('refuses until the identity is confirmed, then files it where the RECORD reads from', async () => {
    const user = userEvent.setup();
    const test = await criticalTest();
    renderDetail(test.id);

    await user.click(await screen.findByRole('button', { name: 'Attach to record' }, LOAD));
    const dialog = await screen.findByRole('dialog', { name: /Attach this report/ }, LOAD);

    const attach = within(dialog).getByRole('button', { name: 'Attach report' });

    // No encounter chosen: clicking writes nothing.
    await user.click(attach);
    expect(listAttachmentsForLab(test.id)).toEqual([]);

    const encounters = await within(dialog).findAllByRole('radio', undefined, LOAD);
    await user.click(encounters[0]!);

    // Chosen but unconfirmed: still nothing.
    await user.click(attach);
    expect(listAttachmentsForLab(test.id)).toEqual([]);
    expect(
      within(dialog).getByText(/Confirm the patient identity before attaching/),
    ).toBeInTheDocument();

    // The confirmation names the patient and the MRN, per UX §2.6.
    const confirm = within(dialog).getByRole('checkbox', {
      name: new RegExp(`Attach to ${test.patient.name}, MRN ${test.patient.mrn}\\?`),
    });
    await user.click(confirm);
    await user.click(attach);

    // It landed in the SHARED store — the one the medical record renders
    // from — rather than in a list the labs screen keeps to itself.
    await waitFor(
      () => {
        expect(listAttachmentsForLab(test.id)).toHaveLength(1);
      },
      LOAD,
    );
    const [stored] = listAttachmentsForLab(test.id);
    expect(stored?.recordId).toMatch(/^MR-/);
    expect(stored?.patientMrn).toBe(test.patient.mrn);

    // And the page reads it back from there, rather than announcing its own
    // optimistic copy.
    await waitFor(
      () => {
        expect(screen.getByText(stored!.name)).toBeInTheDocument();
      },
      LOAD,
    );
  }, CASE_TIMEOUT);

  it('a failed attach leaves the record untouched and says so', async () => {
    const user = userEvent.setup();
    const test = await criticalTest();
    renderDetail(test.id);

    await user.click(await screen.findByRole('button', { name: 'Attach to record' }, LOAD));
    const dialog = await screen.findByRole('dialog', { name: /Attach this report/ }, LOAD);
    const encounters = await within(dialog).findAllByRole('radio', undefined, LOAD);
    await user.click(encounters[0]!);
    await user.click(
      within(dialog).getByRole('checkbox', { name: /^Attach to / }),
    );

    /*
     * Fail the write only once the value has been produced, so the refusal
     * under test is the transport's and not the identity check's. Spied on
     * the store module itself rather than the barrel: `queries.ts` imports
     * from `./store`, and that is the binding a call actually goes through.
     */
    vi.spyOn(attachmentStore, 'attachLabReport').mockRejectedValue(
      new Error('Storage unavailable.'),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Attach report' }));

    await waitFor(
      () => {
        expect(within(dialog).getByText(/Nothing was added to the record/)).toBeInTheDocument();
      },
      LOAD,
    );
    expect(listAttachmentsForLab(test.id)).toEqual([]);
    expect(
      screen.getByText(/This report is not attached to any encounter yet/),
    ).toBeInTheDocument();
  }, CASE_TIMEOUT);
});
