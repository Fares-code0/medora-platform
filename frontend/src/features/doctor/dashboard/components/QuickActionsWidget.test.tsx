import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { routes } from '@/routes';

import { QuickActionsWidget } from './QuickActionsWidget';

/**
 * RM M39.5 — each quick action that names a write opens the flow that
 * performs it (DX-22/DX-23), not a list the doctor then has to search.
 */

function Location() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname + location.search}</output>;
}

function renderAt(): void {
  render(
    <MemoryRouter initialEntries={['/doctor/overview']}>
      <Routes>
        <Route path="*" element={<QuickActionsWidget />} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}

describe('QuickActionsWidget', () => {
  it.each([
    ['New prescription', routes.doctor.newPrescription()],
    ['New record', routes.doctor.newMedicalRecord()],
    ['Order lab', routes.doctor.newLabOrder()],
    ['Message a patient', routes.doctor.composeMessage()],
  ])('"%s" opens its authoring flow', async (label, target) => {
    const user = userEvent.setup();
    renderAt();

    await user.click(screen.getByRole('button', { name: label }));

    expect(screen.getByRole('status', { name: 'location' })).toHaveTextContent(target);
  });

  it('opens flows, not the lists they live in', () => {
    expect(routes.doctor.newPrescription()).not.toBe(routes.doctor.pharmacy);
    expect(routes.doctor.newMedicalRecord()).not.toBe(routes.doctor.medicalRecords);
    expect(routes.doctor.newLabOrder()).not.toBe(routes.doctor.labs);
  });
});
