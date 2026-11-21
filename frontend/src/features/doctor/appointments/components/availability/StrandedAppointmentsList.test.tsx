import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { StrandedRow } from '../../model/availability';

import { StrandedAppointmentsList } from './StrandedAppointmentsList';

/**
 * The list shows device-local times, as every appointment screen does, and
 * adds the clinic's time where the clinic's zone is known and reads
 * differently (BR-DEC-005) — the hours it is judged against are the clinic's.
 */

const ROW: StrandedRow = {
  id: 'APT-1',
  // 08:00 UTC: 22:00 the day before in Honolulu (UTC−10), 22:00 in Kiritimati (UTC+14).
  dateTime: '2030-01-07T08:00:00.000Z',
  patientLabel: 'Khaled Nassar',
  reason: 'outside-hours',
  alreadyOutside: false,
};

function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function renderList(clinicZone: string | null) {
  return render(
    <MemoryRouter>
      <StrandedAppointmentsList rows={[ROW]} clinicZone={clinicZone} />
    </MemoryRouter>,
  );
}

describe('StrandedAppointmentsList', () => {
  it('adds the clinic’s time when its zone reads differently from the device’s', () => {
    const zone = deviceZone() === 'Pacific/Honolulu' ? 'Asia/Tokyo' : 'Pacific/Honolulu';
    const there = zone === 'Pacific/Honolulu' ? '22:00' : '17:00';
    renderList(zone);

    expect(screen.getByText(new RegExp(`\\(${there} clinic time\\)`))).toBeInTheDocument();
  });

  it('adds nothing when the clinic’s zone is unknown or reads the same', () => {
    const { unmount } = renderList(null);
    expect(screen.queryByText(/clinic time/)).not.toBeInTheDocument();
    unmount();

    renderList(deviceZone());
    expect(screen.queryByText(/clinic time/)).not.toBeInTheDocument();
  });

  it('labels a reported appointment the client finds covered without inventing a reason', () => {
    render(
      <MemoryRouter>
        <StrandedAppointmentsList rows={[{ ...ROW, reason: null }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Outside the saved hours')).toBeInTheDocument();
  });
});
