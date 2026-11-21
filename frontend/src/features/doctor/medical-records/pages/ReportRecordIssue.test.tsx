import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { __mockRecordIssueReports, __resetRecordsStore } from '../mock/mock-record-service';
import { recordService } from '../service';

import { MedicalRecordDetailPage } from './MedicalRecordDetailPage';

/**
 * Reporting an issue on a record (API §6.9). The properties that matter: the
 * record does not change, nothing is announced before the write lands, a
 * failure keeps what was typed, and the confirmation names only what the
 * server actually does with a report.
 */

const LOAD = { timeout: 10_000 };
const CASE_TIMEOUT = 30_000;
const RECORD_ID = 'MR-10001';

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

function renderRecord() {
  return render(
    <MemoryRouter initialEntries={[`/doctor/medical-records/${RECORD_ID}`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/medical-records/:recordId" element={<MedicalRecordDetailPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

async function openReportDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'More record actions' }, LOAD));
  await user.click(await screen.findByRole('menuitem', { name: 'Report an issue' }));
  return screen.findByRole('dialog', { name: 'Report an issue with this record' });
}

describe('Report an issue on a record', () => {
  it(
    'refuses an empty description and sends nothing',
    async () => {
      const report = vi.spyOn(recordService, 'reportIssue');
      const user = userEvent.setup();
      renderRecord();

      const dialog = await openReportDialog(user);
      await user.click(within(dialog).getByRole('button', { name: 'Report issue' }));

      expect(
        await within(dialog).findByText('Describe what is wrong so it can be acted on.'),
      ).toBeInTheDocument();
      expect(report).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT,
  );

  it(
    'files the report, confirms only what the server does, and closes',
    async () => {
      const user = userEvent.setup();
      renderRecord();

      const dialog = await openReportDialog(user);
      await user.type(
        within(dialog).getByLabelText(/What is wrong/),
        'The diagnosis says left knee; the note says right.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Report issue' }));

      expect(await screen.findByText(`Issue reported on ${RECORD_ID}`, undefined, LOAD)).toBeInTheDocument();
      expect(
        screen.getByText('It is kept with the record and listed in your activity log.'),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Report an issue with this record' }),
        ).not.toBeInTheDocument();
      });
      expect(__mockRecordIssueReports()).toEqual([
        expect.objectContaining({
          recordId: RECORD_ID,
          description: 'The diagnosis says left knee; the note says right.',
        }),
      ]);
    },
    CASE_TIMEOUT,
  );

  it(
    'keeps the dialog and the text when the write fails, and claims nothing',
    async () => {
      vi.spyOn(recordService, 'reportIssue').mockRejectedValue(new Error('boom'));
      const user = userEvent.setup();
      renderRecord();

      const dialog = await openReportDialog(user);
      const field = within(dialog).getByLabelText(/What is wrong/);
      await user.type(field, 'Wrong patient on this record.');
      await user.click(within(dialog).getByRole('button', { name: 'Report issue' }));

      expect(
        await within(dialog).findByText('The issue was not reported', undefined, LOAD),
      ).toBeInTheDocument();
      expect(field).toHaveValue('Wrong patient on this record.');
      expect(screen.queryByText(`Issue reported on ${RECORD_ID}`)).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );
});
