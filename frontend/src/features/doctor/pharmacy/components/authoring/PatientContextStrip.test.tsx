import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PrescriptionPatientSnapshot } from '../../model/types';

import { PatientContextStrip, type CurrentMedicationsState } from './PatientContextStrip';

/**
 * The pinned strip's "Current medications" is a clinical statement made at
 * the moment of prescribing. It lists every source on the record — another
 * prescriber's course and what the patient reported — and a list that did not
 * load is an error, never "nothing on record".
 */

const PATIENT: PrescriptionPatientSnapshot = {
  id: 'PT-1001',
  name: 'Khaled Nassar',
  mrn: 'MRN-100001',
  age: 52,
  gender: 'male',
  bloodType: 'O+',
  phone: '01000000000',
  allergies: [],
  hasSevereAllergy: false,
};

function renderStrip(state: CurrentMedicationsState) {
  render(<PatientContextStrip patient={PATIENT} currentMedications={state} />);
  return within(screen.getByRole('region', { name: 'Current medications' }));
}

describe('PatientContextStrip — current medications', () => {
  it('lists another prescriber’s course and a patient-reported one, with where each came from', () => {
    const list = renderStrip({
      status: 'success',
      medications: [
        {
          id: 'med-1',
          name: 'Warfarin',
          dosage: '5 mg',
          frequency: 'Once daily',
          prescriptionId: 'RX-20419',
          isHighRisk: null,
        },
        {
          id: 'med-2',
          name: 'Vitamin D',
          dosage: '1000 IU',
          frequency: 'Daily',
          prescriptionId: null,
          isHighRisk: null,
        },
      ],
    });

    expect(list.getByText('Warfarin')).toBeInTheDocument();
    expect(list.getByText(/Prescription RX-20419/)).toBeInTheDocument();
    expect(list.getByText(/Patient-reported/)).toBeInTheDocument();
    // An unknown high-alert flag is not rendered as "not high-alert" either way.
    expect(list.queryByText('High-alert')).not.toBeInTheDocument();
  });

  it('says nothing is on record only when the list answered empty', () => {
    const list = renderStrip({ status: 'success', medications: [] });
    expect(list.getByText('No active medications on record.')).toBeInTheDocument();
  });

  it('shows a failed load as an error with a retry, never as an empty list', async () => {
    const retry = vi.fn();
    const list = renderStrip({ status: 'error', retry });

    expect(list.getByRole('alert')).toHaveTextContent('Couldn’t load current medications.');
    expect(list.queryByText('No active medications on record.')).not.toBeInTheDocument();

    await userEvent.click(list.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('is loading, not empty, while the list is pending', () => {
    const list = renderStrip({ status: 'pending' });
    expect(list.getByText('Loading…')).toBeInTheDocument();
  });
});

/**
 * Medora uses no coloured card edges. A severe allergy used to paint the
 * strip's top edge red; it is now carried by the allergies themselves, as
 * critical (red) badges — the clinical signal, not decoration.
 */
describe('PatientContextStrip — severe allergy', () => {
  const EDGE = /\bbefore:bg-|\bborder-[sltrbe]-(error|warning|success|info|primary|accent|secondary)\b|\bborder-[sltrbe]-(\[\d+px\]|[2-8])\b/;

  it('marks a severe allergy with critical badges, and no coloured card edge', () => {
    const { container } = render(
      <PatientContextStrip
        patient={{ ...PATIENT, allergies: ['Penicillin'], hasSevereAllergy: true }}
        currentMedications={{ status: 'success', medications: [] }}
      />,
    );
    const allergies = within(screen.getByRole('region', { name: 'Recorded allergies' }));
    expect(allergies.getByText('Penicillin').closest('[class*="error"]')).not.toBeNull();
    for (const node of container.querySelectorAll('*')) {
      expect(String(node.getAttribute('class') ?? '')).not.toMatch(EDGE);
    }
  });
});
