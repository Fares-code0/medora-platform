import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clinicOperationsApi } from '@/features/shared-domain/clinic-operations/store';

import { MyClinicPage } from './MyClinicPage';

/**
 * The doctor-scoped clinic board (D-27b).
 *
 * These tests pin the *display* rule, which is all a frontend can own: the
 * board shows this doctor's own clinic and their own patients within it, and
 * an unattributed row is excluded rather than shown. They are deliberately
 * not security tests — the isolation is the server's, and
 * `docs/handoff/clinic-isolation.md` says what it owes. A test here that
 * claimed otherwise would be the most dangerous kind of green.
 */

const session = {
  current: {
    id: 'usr_doctor_amelia',
    role: 'doctor',
    clinicId: 'clinic-meadowbrook',
  } as { id: string; role: string; clinicId?: string } | null,
};

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: session.current }),
}));

const OTHER_CLINIC = 'clinic-elsewhere';

const queueRows = [
  {
    id: 'q-mine',
    clinicId: 'clinic-meadowbrook',
    doctorId: 'usr_doctor_amelia',
    patientId: 'PT-1',
    ticket: 'A-1',
    patientName: 'Mine Ownpatient',
    reason: 'Follow-up',
    priority: 'routine' as const,
    waitingMinutes: 5,
    estimatedMinutes: 10,
    delayed: false,
  },
  {
    id: 'q-colleague',
    clinicId: 'clinic-meadowbrook',
    doctorId: 'usr_doctor_secure',
    patientId: 'PT-2',
    ticket: 'A-2',
    patientName: 'Colleague Patient',
    reason: 'New consultation',
    priority: 'routine' as const,
    waitingMinutes: 9,
    estimatedMinutes: 12,
    delayed: false,
  },
  {
    id: 'q-other-clinic',
    clinicId: OTHER_CLINIC,
    doctorId: 'usr_doctor_amelia',
    patientId: 'PT-3',
    ticket: 'B-1',
    patientName: 'Otherclinic Patient',
    reason: 'Dressing change',
    priority: 'urgent' as const,
    waitingMinutes: 40,
    estimatedMinutes: 5,
    delayed: true,
  },
];

const waitingRows = [
  {
    id: 'w-mine',
    clinicId: 'clinic-meadowbrook',
    doctorId: 'usr_doctor_amelia',
    patientId: 'PT-1',
    patientName: 'Mine Ownpatient',
    appointmentTime: '09:00',
    checkedInAt: '08:52',
    waitingMinutes: 5,
    area: 'Main lobby',
    status: 'waiting' as const,
  },
  {
    id: 'w-other-clinic',
    clinicId: OTHER_CLINIC,
    doctorId: 'usr_doctor_amelia',
    patientId: 'PT-3',
    patientName: 'Otherclinic Patient',
    appointmentTime: '09:30',
    checkedInAt: '09:20',
    waitingMinutes: 10,
    area: 'Annex',
    status: 'waiting' as const,
  },
];

function stubBoard(queue = queueRows, waiting = waitingRows) {
  vi.spyOn(clinicOperationsApi.queue, 'list').mockResolvedValue(queue);
  vi.spyOn(clinicOperationsApi.waitingRoom, 'list').mockResolvedValue(waiting);
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  session.current = {
    id: 'usr_doctor_amelia',
    role: 'doctor',
    clinicId: 'clinic-meadowbrook',
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MyClinicPage', () => {
  it('shows the doctor their own patients and no one else’s', async () => {
    stubBoard();
    render(<MyClinicPage />, { wrapper: Wrapper });

    // The patient is on both cards — queued and checked in — so this is
    // `findAll`, not `find`.
    expect(await screen.findAllByText(/Mine Ownpatient/)).toHaveLength(2);
    expect(screen.queryByText(/Colleague Patient/)).not.toBeInTheDocument();
  });

  it('never renders a row from another clinic, even one attributed to this doctor', async () => {
    /*
     * The sharp case. `q-other-clinic` carries *this doctor's own id* and
     * another clinic's — clinic membership has to be checked first, or a
     * doctor who also practises elsewhere drags those rows onto this board.
     * The positive assertion runs first so the negative one cannot pass
     * merely because nothing has rendered yet.
     */
    stubBoard();
    render(<MyClinicPage />, { wrapper: Wrapper });

    expect((await screen.findAllByText(/Mine Ownpatient/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Otherclinic Patient/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Annex/)).not.toBeInTheDocument();
  });

  it('counts colleagues’ waiting patients instead of hiding them', async () => {
    /*
     * "Nobody is waiting for you" with three people in the room is a board
     * that reads as broken. The count carries no patient identity.
     */
    stubBoard(
      queueRows.filter((row) => row.doctorId !== 'usr_doctor_amelia'),
      [],
    );
    render(<MyClinicPage />, { wrapper: Wrapper });

    expect(await screen.findByText('Nobody is waiting for you')).toBeInTheDocument();
    expect(screen.getByText(/1 patient is waiting for other clinicians/)).toBeInTheDocument();
  });

  it('excludes an unattributed row rather than defaulting it visible', async () => {
    stubBoard(
      [...queueRows, { ...queueRows[0]!, id: 'q-orphan', clinicId: '', patientName: 'Orphan Row' }],
      [],
    );
    render(<MyClinicPage />, { wrapper: Wrapper });

    expect(await screen.findByText(/A-1 · Mine Ownpatient/)).toBeInTheDocument();
    expect(screen.queryByText(/Orphan Row/)).not.toBeInTheDocument();
  });

  it('fails closed for a doctor whose session names no clinic (AF-17, WEB-5)', async () => {
    /*
     * A live session never carries the mock's `clinicId`. The scope used to
     * read that as an administrator's "every clinic" and show the whole
     * board; it must show nothing, say why, and not fetch the board at all.
     */
    stubBoard();
    session.current = { id: 'usr_doctor_amelia', role: 'doctor' };
    render(<MyClinicPage />, { wrapper: Wrapper });

    expect(await screen.findByText('Your session does not name a clinic')).toBeInTheDocument();
    expect(screen.queryByText(/Mine Ownpatient/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Colleague Patient/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Otherclinic Patient/)).not.toBeInTheDocument();
    expect(clinicOperationsApi.queue.list).not.toHaveBeenCalled();
    expect(clinicOperationsApi.waitingRoom.list).not.toHaveBeenCalled();
  });

  it('treats an empty clinic id as no clinic, not as every clinic', async () => {
    stubBoard();
    session.current = { id: 'usr_doctor_amelia', role: 'doctor', clinicId: '' };
    render(<MyClinicPage />, { wrapper: Wrapper });

    expect(await screen.findByText('Your session does not name a clinic')).toBeInTheDocument();
    expect(clinicOperationsApi.queue.list).not.toHaveBeenCalled();
  });

  it('says on screen that the server, not this page, enforces the isolation', async () => {
    /*
     * Load-bearing prose. A board that silently filters invites the next
     * reader to treat the filter as the control; saying so is what keeps
     * `docs/handoff/clinic-isolation.md` from being the only place it is
     * written down.
     */
    stubBoard();
    render(<MyClinicPage />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/enforced by the server/i)).toBeInTheDocument();
    });
  });
});
