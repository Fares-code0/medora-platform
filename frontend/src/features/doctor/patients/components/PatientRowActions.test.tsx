import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';
import { routes } from '@/routes';

import { PatientRowActions } from './PatientRowActions';

/**
 * Every row action carries the patient it sits on (NEW-06, NEW-07, Q-03).
 *
 * The row used to send "Send message" to the bare inbox, "Schedule
 * appointment" to the bare book, "View lab results" with a `?patientId=`
 * the labs list never reads, and "View prescriptions" with no patient at
 * all — each one a click that landed the doctor somewhere other than where
 * the label promised. These pin each destination to the param its target
 * actually reads, and to the same URL the profile header builds.
 */

const patient = MOCK_PATIENTS[0]!;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderRow() {
  render(
    <MemoryRouter initialEntries={['/doctor/patients']}>
      <Routes>
        <Route path="*" element={<PatientRowActions patient={patient} />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function location() {
  return screen.getByTestId('location').textContent;
}

async function choose(label: string) {
  await userEvent.click(screen.getByRole('button', { name: `More actions for ${patient.name}` }));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByRole('menuitem', { name: label }));
}

describe('PatientRowActions', () => {
  it('opens this patient’s thread from the inline message shortcut', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: `Send message to ${patient.name}` }));
    expect(location()).toBe(routes.doctor.composeMessage({ patientId: patient.id }));
  });

  it('opens booking with this patient from the inline schedule shortcut', async () => {
    renderRow();
    await userEvent.click(
      screen.getByRole('button', { name: `Schedule appointment for ${patient.name}` }),
    );
    expect(location()).toBe(routes.doctor.bookAppointment({ patientId: patient.id }));
  });

  it.each([
    ['View profile', routes.doctor.patient(patient.id)],
    ['Open medical record', `${routes.doctor.medicalRecords}?patient=${patient.id}`],
    ['View lab results', `${routes.doctor.labs}?patient=${patient.id}`],
    ['View prescriptions', `${routes.doctor.pharmacy}?patient=${patient.id}`],
    ['Send message', routes.doctor.composeMessage({ patientId: patient.id })],
    ['Schedule appointment', routes.doctor.bookAppointment({ patientId: patient.id })],
  ])('menu “%s” lands on %s', async (label, expected) => {
    renderRow();
    await choose(label);
    expect(location()).toBe(expected);
  });
});
