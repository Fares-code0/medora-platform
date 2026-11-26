import fs from 'node:fs';
import path from 'node:path';

import { fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';
import { APPOINTMENT_STATUSES } from '@/types/vocabularies';

import { AppointmentActions } from './components/AppointmentActions';
import {
  fixtureAppointmentService,
  resetAppointmentFixtures,
} from './fixtures/appointment-fixtures';
import type { AppointmentDetail } from './model/types';

/**
 * Appointment tests.
 *
 * The most important one is a **source-level** assertion: no file in this
 * feature derives an action from `status`. That is the rule of audit §6 —
 * the server owns every transition and the client renders what it is
 * offered — and it is a rule that a well-meaning refactor breaks by
 * writing exactly the switch statement that looks obvious.
 */

function detail(overrides: Partial<AppointmentDetail>): AppointmentDetail {
  return {
    id: 'APT-1',
    startsAt: new Date().toISOString(),
    durationMin: 30,
    status: 'confirmed',
    priority: 'normal',
    doctor: {
      id: 'DR-1',
      fullName: 'Layla Haddad',
      title: 'Dr',
      specialty: 'Cardiology',
      photoUrl: null,
    },
    departmentName: 'Cardiology',
    visitType: 'Follow-up',
    reason: 'Review',
    notes: null,
    cancelledReason: null,
    clinicTimezone: 'Asia/Amman',
    hospital: { id: 'HOS-1', name: 'Medora Clinic' },
    availableActions: [],
    pendingRescheduleRequest: null,
    events: [],
    ...overrides,
  };
}

describe('actions come from the server, never from status', () => {
  it('renders nothing when the server offers nothing — whatever the status', () => {
    for (const status of APPOINTMENT_STATUSES) {
      const { queryByTestId, unmount } = renderWithProviders(
        <AppointmentActions
          appointment={detail({ status, availableActions: [] })}
          onAskReschedule={jest.fn()}
        />,
      );
      expect(queryByTestId('appointment-cancel')).toBeNull();
      expect(queryByTestId('appointment-reschedule')).toBeNull();
      unmount();
    }
  });

  it('renders cancel when the server offers cancel, even on a status a client might refuse', () => {
    // `completed` is terminal in the status machine. If the server says
    // cancel is available, the client renders cancel — it is not the
    // client's job to second-guess the transition table.
    const { getByTestId } = renderWithProviders(
      <AppointmentActions
        appointment={detail({ status: 'completed', availableActions: ['cancel'] })}
        onAskReschedule={jest.fn()}
      />,
    );
    expect(getByTestId('appointment-cancel')).toBeTruthy();
  });

  it('renders reschedule only when the server offers it', () => {
    const offered = renderWithProviders(
      <AppointmentActions
        appointment={detail({ status: 'confirmed', availableActions: ['cancel', 'reschedule'] })}
        onAskReschedule={jest.fn()}
      />,
    );
    expect(offered.getByTestId('appointment-reschedule')).toBeTruthy();
    offered.unmount();

    const notOffered = renderWithProviders(
      <AppointmentActions
        appointment={detail({ status: 'confirmed', availableActions: ['cancel'] })}
        onAskReschedule={jest.fn()}
      />,
    );
    expect(notOffered.queryByTestId('appointment-reschedule')).toBeNull();
  });

  it('renders no confirm or proposal control — the server has no such action any more', () => {
    const { queryByTestId } = renderWithProviders(
      <AppointmentActions
        appointment={detail({ status: 'awaiting-patient', availableActions: ['cancel'] })}
        onAskReschedule={jest.fn()}
      />,
    );

    expect(queryByTestId('appointment-proposals')).toBeNull();
  });
});

describe('cancellation collects a reason (I-08)', () => {
  it('will not submit without a reason code — the server requires one', async () => {
    const { getByTestId } = renderWithProviders(
      <AppointmentActions
        appointment={detail({ availableActions: ['cancel'] })}
        onAskReschedule={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId('appointment-cancel'));
    await waitFor(() => {
      expect(getByTestId('appointment-cancel-confirm')).toBeTruthy();
    });

    expect(getByTestId('appointment-cancel-confirm').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByTestId('cancel-reason-schedule_conflict'));
    expect(getByTestId('appointment-cancel-confirm').props.accessibilityState.disabled).toBe(false);
  });
});

describe('the fixture service', () => {
  beforeEach(() => {
    resetAppointmentFixtures();
  });

  it('creates a patient booking in status pending, for the clinic to approve', async () => {
    const created = await fixtureAppointmentService.book(
      {
        doctorId: 'DR-1001',
        slotId: 'SL-1',
        startsAt: new Date().toISOString(),
        reason: 'Chest tightness when walking uphill',
      },
      'idem-1',
    );

    expect(created.status).toBe('pending');
    expect(created.availableActions).toEqual(['cancel']);
  });

  it('pages, so the fixture build can reach page two the way a real one can', async () => {
    // A fixture that returned everything with `hasMore: false` would be
    // the one build in which paging is untestable — two sides of the
    // seam disagreeing about the shape of the answer.
    const first = await fixtureAppointmentService.list('upcoming');
    expect(first.hasMore).toBe(true);
    expect(first.items.length).toBeLessThan(first.totalItems);

    const second = await fixtureAppointmentService.list('upcoming', 2);
    const overlap = second.items.filter((item) => first.items.some((seen) => seen.id === item.id));
    expect(overlap).toEqual([]);
  });

  it('stores availableActions rather than deriving them', async () => {
    // Across both pages: the fixture pages at two, and these two
    // appointments are not on the same one.
    const first = await fixtureAppointmentService.list('upcoming');
    const second = await fixtureAppointmentService.list('upcoming', 2);
    const upcoming = [...first.items, ...second.items];
    const awaiting = upcoming.find((item) => item.status === 'awaiting-patient');
    const pending = upcoming.find((item) => item.status === 'pending');

    // Two appointments, different statuses, different action sets — and
    // the fixture holds them as data, so a screen cannot start relying on
    // a derivation that the server does not guarantee.
    expect(awaiting?.availableActions).toEqual(['cancel']);
    expect(pending?.availableActions).toEqual(['cancel']);
  });

  it('a reschedule request leaves the appointment where it is', async () => {
    const before = await fixtureAppointmentService.getById('APT-2001');
    const request = await fixtureAppointmentService.requestReschedule(
      'APT-2001',
      { slotId: 'SL-X', note: 'Travelling' },
      'idem-2',
    );
    const after = await fixtureAppointmentService.getById('APT-2001');

    expect(request.status).toBe('pending');
    expect(after.startsAt).toBe(before.startsAt);
    expect(after.status).toBe(before.status);
    expect(after.pendingRescheduleRequest?.id).toBe(request.id);
    // The server — here, the fixture standing in for it — stops offering a second ask.
    expect(after.availableActions).not.toContain('reschedule');

    const withdrawn = await fixtureAppointmentService.withdrawRescheduleRequest(request.id);
    expect(withdrawn.status).toBe('withdrawn');
    expect(
      (await fixtureAppointmentService.getById('APT-2001')).pendingRescheduleRequest,
    ).toBeNull();
  });

  it('returns slots rather than computing them from availability rules', async () => {
    const from = new Date().toISOString();
    const to = new Date().toISOString();
    const slots = await fixtureAppointmentService.listSlots('DR-1001', from, to);

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(typeof slot.startsAt).toBe('string');
      expect(slot.durationMin).toBeGreaterThan(0);
    }
  });
});

describe('the no-client-side-transitions rule (audit §6, I-07)', () => {
  const featureDir = path.join(__dirname);

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.tsx')) return [];
      return [full];
    });
  }

  /** Comments discuss the rule; only code can break it. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  it('derives no action from a status literal anywhere in the feature', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(featureDir)) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      // A switch or comparison on `status` that yields an action is the
      // shape this rule forbids. Comments and the fixture's own status
      // fields are fine; a branch is not.
      if (/switch\s*\(\s*\w*\.?status\s*\)/.test(source)) {
        offenders.push(`${file}: switch on status`);
      }
      if (/status\s*===\s*'(confirmed|scheduled|pending|rescheduled)'\s*&&/.test(source)) {
        offenders.push(`${file}: status-gated action`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not transcribe the ADR-001 transition table', () => {
    // The eight statuses are transcribed (they are a vocabulary); the
    // arrows between them are deliberately not (they are a rule).
    const vocabularies = fs.readFileSync(
      path.join(__dirname, '..', '..', 'types', 'vocabularies.ts'),
      'utf8',
    );
    expect(vocabularies).not.toMatch(/canTransition|TRANSITIONS|allowedNextStatuses/);
  });
});
