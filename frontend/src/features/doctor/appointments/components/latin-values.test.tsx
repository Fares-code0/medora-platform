import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MOCK_APPOINTMENTS } from '../model/mock-data';

import { buildAppointmentColumns } from './appointment-table-columns';
import { AppointmentPatientCell } from './AppointmentCells';

/**
 * "30 min" and "61 · M" start with a digit, so on an RTL page the bidi
 * algorithm reorders them to "min 30" and "M · 61" (NEW-32, pass 8). Each is
 * pinned left-to-right; jsdom has no bidi layout, so the isolation the
 * browser acts on is what is asserted.
 */

const APPOINTMENT = MOCK_APPOINTMENTS[0];
if (APPOINTMENT === undefined) throw new Error('appointment seed is empty');

describe('appointments — Latin-only values in RTL', () => {
  it('pins the duration cell left-to-right', () => {
    const column = buildAppointmentColumns({ onOpenDetails: vi.fn(), onAction: vi.fn() }).find(
      (c) => c.id === 'duration',
    );
    if (column === undefined) throw new Error('no duration column');
    const { container } = render(<>{column.cell(APPOINTMENT)}</>);

    expect(container.querySelector('[dir="ltr"]')?.textContent).toBe(
      `${String(APPOINTMENT.durationMin)} min`,
    );
  });

  it('pins the age · sex line under the patient left-to-right', () => {
    const { container } = render(<AppointmentPatientCell appointment={APPOINTMENT} />);

    expect(container.querySelector('[dir="ltr"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `${String(APPOINTMENT.patient.age)} · ${APPOINTMENT.patient.gender === 'female' ? 'F' : 'M'}`,
    );
  });
});
