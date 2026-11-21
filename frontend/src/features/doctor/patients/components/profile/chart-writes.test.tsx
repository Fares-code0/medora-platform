import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { __resetMockProfileWrites } from '../../mock/mock-profile-service';
import { PatientProfilePage } from '../../pages/PatientProfilePage';
import { patientProfileService } from '../../service';

/**
 * Raising a clinical alert and adding a medical-history event from the chart.
 * Neither has a default category — severity and kind are clinical calls —
 * and neither is announced before the chart has refetched with it. A failure
 * keeps the form and says so.
 */

const LOAD = { timeout: 10_000 };
const CASE_TIMEOUT = 30_000;
const PATIENT_ID = MOCK_PATIENTS[1]?.id ?? '';

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

function renderChart(tab: string) {
  return render(
    <MemoryRouter initialEntries={[`/doctor/patients/${PATIENT_ID}?tab=${tab}`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/patients/:patientId" element={<PatientProfilePage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('Raise a clinical alert', () => {
  async function openDialog() {
    await userEvent.click(await screen.findByRole('button', { name: 'Raise alert' }, LOAD));
    return screen.findByRole('dialog', { name: 'Raise a clinical alert' });
  }

  it(
    'has no default severity and sends nothing until one is chosen',
    async () => {
      const add = vi.spyOn(patientProfileService, 'addAlert');
      renderChart('overview');
      const dialog = await openDialog();

      await userEvent.type(within(dialog).getByLabelText(/^Alert/), 'Check INR before procedures.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Raise alert' }));

      expect(within(dialog).getByText('Choose a severity')).toBeInTheDocument();
      expect(within(dialog).getByRole('radio', { name: /Critical/ })).not.toBeChecked();
      expect(within(dialog).getByRole('radio', { name: /Warning/ })).not.toBeChecked();
      expect(add).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT,
  );

  it(
    'shows the banner on the Overview before announcing it',
    async () => {
      renderChart('overview');
      const dialog = await openDialog();

      await userEvent.click(within(dialog).getByRole('radio', { name: /Critical/ }));
      await userEvent.type(
        within(dialog).getByLabelText(/^Alert/),
        'On warfarin — check INR before any procedure.',
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Raise alert' }));

      expect(await screen.findByText('Critical alert raised', undefined, LOAD)).toBeInTheDocument();
      // The banner is on the chart by the time the toast says so.
      expect(screen.getByText('On warfarin — check INR before any procedure.')).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'keeps the form and names the failure when the write is refused',
    async () => {
      vi.spyOn(patientProfileService, 'addAlert').mockRejectedValue(
        Object.assign(new Error('API error: validation'), {
          kind: 'validation',
          detail: 'Say what the alert is',
        }),
      );
      renderChart('overview');
      const dialog = await openDialog();

      await userEvent.click(within(dialog).getByRole('radio', { name: /Warning/ }));
      const field = within(dialog).getByLabelText(/^Alert/);
      await userEvent.type(field, 'Falls risk.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Raise alert' }));

      expect(
        await within(dialog).findByText('The alert was not raised', undefined, LOAD),
      ).toBeInTheDocument();
      expect(field).toHaveValue('Falls risk.');
      expect(screen.queryByText('Warning raised')).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );
});

describe('Add a medical-history event', () => {
  async function openDialog() {
    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }, LOAD));
    return screen.findByRole('dialog', { name: 'Add to medical history' });
  }

  it(
    'requires a kind and a date, and refuses a date in the future',
    async () => {
      const add = vi.spyOn(patientProfileService, 'addHistoryEvent');
      renderChart('history');
      const dialog = await openDialog();

      await userEvent.type(within(dialog).getByLabelText(/^Event/), 'Appendectomy');
      await userEvent.type(within(dialog).getByLabelText(/^Date/), '2999-01-01');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add event' }));

      expect(within(dialog).getByText('Choose what kind of event this is')).toBeInTheDocument();
      expect(
        within(dialog).getByText('A history event cannot be in the future'),
      ).toBeInTheDocument();
      expect(add).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT,
  );

  it(
    'adds the event to the timeline before announcing it',
    async () => {
      const user = userEvent.setup();
      renderChart('history');
      const dialog = await openDialog();

      await user.click(within(dialog).getByRole('combobox', { name: /Kind/ }));
      await user.click(await screen.findByRole('option', { name: 'Surgery' }));
      await user.type(within(dialog).getByLabelText(/^Event/), 'Laparoscopic cholecystectomy');
      await user.type(within(dialog).getByLabelText(/^Date/), '2019-05-14');
      await user.click(within(dialog).getByRole('button', { name: 'Add event' }));

      expect(
        await screen.findByText(
          'Laparoscopic cholecystectomy added to the history',
          undefined,
          LOAD,
        ),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Add to medical history' }),
        ).not.toBeInTheDocument();
      });
      expect(
        within(screen.getByRole('tabpanel')).getByText('Laparoscopic cholecystectomy'),
      ).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );
});

describe('Emergency contacts', () => {
  it(
    'refuses a phone the server would refuse, before sending anything',
    async () => {
      const add = vi.spyOn(patientProfileService, 'addEmergencyContact');
      renderChart('overview');
      await screen.findByRole('heading', { name: 'Emergency contacts' }, LOAD);
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add an emergency contact' });

      await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Omar Nassar');
      await userEvent.type(within(dialog).getByLabelText(/^Relationship/), 'Brother');
      await userEvent.type(within(dialog).getByLabelText(/^Phone/), 'call me');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));

      expect(within(dialog).getByText('Enter a valid phone number')).toBeInTheDocument();
      expect(add).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT,
  );

  it(
    'makes an added contact primary and moves the badge to it',
    async () => {
      renderChart('overview');
      await screen.findByRole('heading', { name: 'Emergency contacts' }, LOAD);
      await userEvent.click(screen.getByRole('button', { name: 'Add' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add an emergency contact' });

      await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Omar Nassar');
      await userEvent.type(within(dialog).getByLabelText(/^Relationship/), 'Brother');
      await userEvent.type(within(dialog).getByLabelText(/^Phone/), '+20 100 123 4567');
      await userEvent.click(within(dialog).getByRole('checkbox', { name: /Primary contact/ }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add contact' }));

      expect(await screen.findByText('Omar Nassar added', undefined, LOAD)).toBeInTheDocument();
      const item = screen.getByRole('button', { name: 'Edit Omar Nassar' }).closest('li');
      expect(item).not.toBeNull();
      expect(within(item as HTMLElement).getByText('Primary')).toBeInTheDocument();
      expect(screen.getAllByText('Primary')).toHaveLength(1);
    },
    CASE_TIMEOUT,
  );
});

describe('Resolving an alert — DEC-003', () => {
  it(
    'says the record is kept, and the banner leaves only once the server confirms',
    async () => {
      await patientProfileService.addAlert(PATIENT_ID, {
        severity: 'critical',
        message: 'Check INR before any procedure.',
      });
      renderChart('overview');

      await screen.findByText('Check INR before any procedure.', undefined, LOAD);
      await userEvent.click(
        screen.getByRole('button', { name: 'Resolve alert: Check INR before any procedure.' }),
      );
      const dialog = await screen.findByRole('alertdialog', { name: 'Resolve this alert?' });
      expect(within(dialog).getByText(/It does\s+not delete it/)).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve alert' }));

      expect(await screen.findByText('Alert resolved', undefined, LOAD)).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.queryByText('Check INR before any procedure.')).not.toBeInTheDocument();
      });
    },
    CASE_TIMEOUT,
  );

  it(
    'keeps the alert and the dialog, and names the failure, when the write is refused',
    async () => {
      await patientProfileService.addAlert(PATIENT_ID, {
        severity: 'warning',
        message: 'Falls risk.',
      });
      vi.spyOn(patientProfileService, 'resolveAlert').mockRejectedValue(new Error('boom'));
      renderChart('overview');

      await screen.findByText('Falls risk.', undefined, LOAD);
      await userEvent.click(screen.getByRole('button', { name: 'Resolve alert: Falls risk.' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Resolve this alert?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve alert' }));

      expect(
        await within(dialog).findByText('The alert was not resolved', undefined, LOAD),
      ).toBeInTheDocument();
      expect(screen.queryByText('Alert resolved')).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );
});

describe('Removing an emergency contact — DEC-003', () => {
  it(
    'warns that removing the primary promotes no one, then removes it',
    async () => {
      await patientProfileService.addEmergencyContact(PATIENT_ID, {
        name: 'Omar Nassar',
        relationship: 'Brother',
        phone: '+20 100 123 4567',
        isPrimary: true,
      });
      renderChart('overview');

      await userEvent.click(
        await screen.findByRole('button', { name: 'Remove Omar Nassar' }, LOAD),
      );
      const dialog = await screen.findByRole('alertdialog', { name: 'Remove Omar Nassar?' });
      expect(within(dialog).getByText('This is the primary contact')).toBeInTheDocument();

      await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Patient asked');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove contact' }));

      expect(await screen.findByText('Omar Nassar removed', undefined, LOAD)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove Omar Nassar' })).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );

  it(
    'requires a reason and sends it with the removal (BR-DEC-003)',
    async () => {
      const remove = vi.spyOn(patientProfileService, 'removeEmergencyContact');
      await patientProfileService.addEmergencyContact(PATIENT_ID, {
        name: 'Omar Nassar',
        relationship: 'Brother',
        phone: '+20 100 123 4567',
        isPrimary: false,
      });
      renderChart('overview');

      await userEvent.click(
        await screen.findByRole('button', { name: 'Remove Omar Nassar' }, LOAD),
      );
      const dialog = await screen.findByRole('alertdialog', { name: 'Remove Omar Nassar?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove contact' }));

      expect(within(dialog).getByText('Give a reason')).toBeInTheDocument();
      expect(remove).not.toHaveBeenCalled();

      await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Number disconnected');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove contact' }));

      expect(await screen.findByText('Omar Nassar removed', undefined, LOAD)).toBeInTheDocument();
      expect(remove).toHaveBeenCalledWith(PATIENT_ID, expect.any(String), 'Number disconnected');
    },
    CASE_TIMEOUT,
  );
});

describe('Resolving an alert with a reason — BR-DEC-003', () => {
  it(
    'sends the optional reason when one is written',
    async () => {
      const resolve = vi.spyOn(patientProfileService, 'resolveAlert');
      await patientProfileService.addAlert(PATIENT_ID, {
        severity: 'warning',
        message: 'Falls risk.',
      });
      renderChart('overview');

      await screen.findByText('Falls risk.', undefined, LOAD);
      await userEvent.click(screen.getByRole('button', { name: 'Resolve alert: Falls risk.' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Resolve this alert?' });
      await userEvent.type(
        within(dialog).getByLabelText(/^Reason/),
        '  Mobilising independently  ',
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve alert' }));

      expect(await screen.findByText('Alert resolved', undefined, LOAD)).toBeInTheDocument();
      expect(resolve).toHaveBeenCalledWith(
        PATIENT_ID,
        expect.any(String),
        'Mobilising independently',
      );
    },
    CASE_TIMEOUT,
  );
});

describe('Removing a history event — DEC-003, BR-DEC-003', () => {
  async function openRemoval() {
    const events = await patientProfileService.getTab(PATIENT_ID, 'history');
    const event = events[0];
    if (event === undefined) throw new Error('the generated chart has no history');
    renderChart('history');
    await userEvent.click(
      await screen.findByRole('button', { name: `Remove history event: ${event.title}` }, LOAD),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove this history event?',
    });
    return { event, dialog };
  }

  it(
    'refuses to send without a reason, and says the entry is kept, not erased',
    async () => {
      const remove = vi.spyOn(patientProfileService, 'removeHistoryEvent');
      const { dialog } = await openRemoval();

      expect(within(dialog).getByText(/It is not erased/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Removed events cannot be shown/)).toBeInTheDocument();

      await userEvent.type(within(dialog).getByLabelText(/^Reason/), '   ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove event' }));

      expect(within(dialog).getByText('Give a reason')).toBeInTheDocument();
      expect(remove).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT,
  );

  it(
    'takes the event off the timeline only once the server has removed it',
    async () => {
      const { event, dialog } = await openRemoval();

      await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Entered on the wrong chart');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove event' }));

      expect(await screen.findByText('History event removed', undefined, LOAD)).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: `Remove history event: ${event.title}` }),
        ).not.toBeInTheDocument();
      });
    },
    CASE_TIMEOUT,
  );

  it(
    'keeps the event and the dialog, and names the failure, when the removal is refused',
    async () => {
      vi.spyOn(patientProfileService, 'removeHistoryEvent').mockRejectedValue(
        Object.assign(new Error('API error: validation'), {
          kind: 'validation',
          detail: 'A reason is required to remove a history event',
        }),
      );
      const { event, dialog } = await openRemoval();

      await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Duplicate');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove event' }));

      expect(
        await within(dialog).findByText('The event was not removed', undefined, LOAD),
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText(/^Reason/)).toHaveValue('Duplicate');
      expect(screen.queryByText('History event removed')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Remove history event: ${event.title}` }),
      ).toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );
});
