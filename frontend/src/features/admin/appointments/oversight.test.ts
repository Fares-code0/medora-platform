import { describe, expect, it } from 'vitest';

import {
  ageInStateMs,
  availableActions,
  buildHeatmap,
  canNudge,
  eligibleReassignTargets,
  EMPTY_FILTERS,
  filterAppointments,
  flagsFor,
  formatAge,
  isStuckPending,
  matchesFilters,
  NUDGE_COOLDOWN_MINUTES,
  REPEATED_RESCHEDULE_THRESHOLD,
  STUCK_PENDING_HOURS,
  summarize,
  validateReason,
} from './oversight';
import type {
  OversightAppointment,
  OversightStatus,
  PlatformDoctor,
} from './oversight.types';

/**
 * The rules behind ADM-05, tested where they live.
 *
 * What is being pinned here is not "a table renders" — it is the judgement
 * the page encodes: when a request counts as stuck, which interventions are
 * legal in which state, who may receive a reassignment, and (the one with
 * teeth) that the search box cannot be used to resolve a masked patient.
 */

const HOUR = 3_600_000;
const NOW = new Date('2026-08-11T12:00:00.000Z').getTime();

function ago(hours: number): string {
  return new Date(NOW - hours * HOUR).toISOString();
}

function appointment(overrides: Partial<OversightAppointment> = {}): OversightAppointment {
  return {
    id: 'apt-1',
    reference: 'APT-1',
    startsAt: new Date(NOW + 24 * HOUR).toISOString(),
    durationMin: 30,
    visitType: 'Consultation',
    department: 'Cardiology',
    specialty: 'Cardiology',
    doctorId: 'doc-a',
    doctorName: 'Dr. A',
    patientId: 'PT-1001',
    patientName: 'Khaled Nassar',
    patientMrn: '4411-27',
    status: 'pending',
    stateSince: ago(2),
    rescheduleCount: 0,
    complaint: null,
    lastNudgedAt: null,
    events: [],
    notifications: [],
    ...overrides,
  };
}

function doctor(overrides: Partial<PlatformDoctor> = {}): PlatformDoctor {
  return {
    id: 'doc-b',
    name: 'Dr. B',
    specialty: 'Cardiology',
    department: 'Cardiology',
    availability: 'available',
    openSlotsToday: 2,
    loadPercent: 50,
    note: null,
    ...overrides,
  };
}

describe('age in state', () => {
  it('measures from the last transition, not from the booking', () => {
    expect(ageInStateMs(appointment({ stateSince: ago(5) }), NOW)).toBe(5 * HOUR);
  });

  it('never reports a negative age for a clock skewed into the future', () => {
    const future = new Date(NOW + 3 * HOUR).toISOString();
    expect(ageInStateMs(appointment({ stateSince: future }), NOW)).toBe(0);
  });

  it('formats minutes, hours and days as an operator would say them', () => {
    expect(formatAge(30_000)).toBe('just now');
    expect(formatAge(45 * 60_000)).toBe('45 min');
    expect(formatAge(2 * HOUR)).toBe('2 h');
    expect(formatAge(2.5 * HOUR)).toBe('2 h 30 min');
    expect(formatAge(50 * HOUR)).toBe('2 d 2 h');
    expect(formatAge(72 * HOUR)).toBe('3 d');
  });
});

describe('flags', () => {
  it('calls a pending request stuck exactly at the threshold, not before', () => {
    const justUnder = appointment({ stateSince: ago(STUCK_PENDING_HOURS - 0.1) });
    const atThreshold = appointment({ stateSince: ago(STUCK_PENDING_HOURS) });

    expect(isStuckPending(justUnder, NOW)).toBe(false);
    expect(isStuckPending(atThreshold, NOW)).toBe(true);
  });

  it('only counts pending time — an old confirmed booking is not stuck', () => {
    const old = appointment({ status: 'confirmed', stateSince: ago(200) });

    expect(isStuckPending(old, NOW)).toBe(false);
    expect(flagsFor(old, NOW)).toEqual([]);
  });

  it('raises every applicable flag at once', () => {
    const trouble = appointment({
      stateSince: ago(48),
      rescheduleCount: REPEATED_RESCHEDULE_THRESHOLD,
      complaint: {
        id: 'cmp-1',
        category: 'Waiting time',
        summary: 'Moved three times.',
        openedAt: ago(30),
        status: 'open',
      },
    });

    expect(flagsFor(trouble, NOW)).toEqual([
      'stuck-pending',
      'repeated-reschedules',
      'complaint-attached',
    ]);
  });
});

describe('the KPI strip', () => {
  const startedDaysAgo = (days: number, status: OversightStatus): OversightAppointment =>
    appointment({
      id: `apt-${String(days)}-${status}`,
      status,
      startsAt: new Date(NOW - days * 24 * HOUR).toISOString(),
    });

  it('quotes both rates against the same 7-day denominator', () => {
    const summary = summarize(
      [
        startedDaysAgo(1, 'completed'),
        startedDaysAgo(2, 'completed'),
        startedDaysAgo(3, 'cancelled'),
        startedDaysAgo(4, 'no-show'),
        // Outside the window: must not move either rate.
        startedDaysAgo(30, 'cancelled'),
      ],
      NOW,
    );

    expect(summary.window7dTotal).toBe(4);
    expect(summary.cancellationRate7d).toBe(25);
    expect(summary.noShowRate7d).toBe(25);
  });

  it('reports zero rates rather than dividing by nothing', () => {
    const summary = summarize([startedDaysAgo(30, 'cancelled')], NOW);

    expect(summary.window7dTotal).toBe(0);
    expect(summary.cancellationRate7d).toBe(0);
    expect(summary.noShowRate7d).toBe(0);
  });

  it('counts today by calendar day and stuck requests by the same threshold as the flag', () => {
    const today = appointment({ id: 'today', startsAt: new Date(NOW + 2 * HOUR).toISOString() });
    const stuck = appointment({ id: 'stuck', stateSince: ago(STUCK_PENDING_HOURS + 1) });

    const summary = summarize([today, stuck], NOW);

    expect(summary.todayTotal).toBe(1);
    expect(summary.pendingOverThreshold).toBe(1);
  });
});

describe('filtering', () => {
  it('never resolves a patient name or MRN through the search box', () => {
    const row = appointment();

    // The masked value is on the record and is deliberately unreachable.
    expect(matchesFilters(row, { ...EMPTY_FILTERS, query: 'Khaled' }, NOW)).toBe(false);
    expect(matchesFilters(row, { ...EMPTY_FILTERS, query: '4411-27' }, NOW)).toBe(false);
    expect(matchesFilters(row, { ...EMPTY_FILTERS, query: 'APT-1' }, NOW)).toBe(true);
    expect(matchesFilters(row, { ...EMPTY_FILTERS, query: 'dr. a' }, NOW)).toBe(true);
  });

  it('applies status, doctor, department and flag together', () => {
    const row = appointment({ stateSince: ago(40) });

    expect(matchesFilters(row, { ...EMPTY_FILTERS, status: 'confirmed' }, NOW)).toBe(false);
    expect(matchesFilters(row, { ...EMPTY_FILTERS, doctorId: 'doc-z' }, NOW)).toBe(false);
    expect(matchesFilters(row, { ...EMPTY_FILTERS, department: 'Oncology' }, NOW)).toBe(false);
    expect(matchesFilters(row, { ...EMPTY_FILTERS, flag: 'complaint-attached' }, NOW)).toBe(false);
    expect(matchesFilters(row, { ...EMPTY_FILTERS, flag: 'stuck-pending' }, NOW)).toBe(true);
  });

  it('looks both forwards and backwards within a range', () => {
    const past = appointment({ startsAt: new Date(NOW - 3 * 24 * HOUR).toISOString() });
    const future = appointment({ startsAt: new Date(NOW + 3 * 24 * HOUR).toISOString() });
    const distant = appointment({ startsAt: new Date(NOW + 20 * 24 * HOUR).toISOString() });

    for (const row of [past, future]) {
      expect(matchesFilters(row, { ...EMPTY_FILTERS, range: '7d' }, NOW)).toBe(true);
    }
    expect(matchesFilters(distant, { ...EMPTY_FILTERS, range: '7d' }, NOW)).toBe(false);
    expect(matchesFilters(distant, { ...EMPTY_FILTERS, range: '30d' }, NOW)).toBe(true);
    expect(matchesFilters(distant, { ...EMPTY_FILTERS, range: 'all' }, NOW)).toBe(true);
  });

  it('orders the result soonest first', () => {
    const later = appointment({ id: 'b', startsAt: new Date(NOW + 5 * HOUR).toISOString() });
    const sooner = appointment({ id: 'a', startsAt: new Date(NOW + 1 * HOUR).toISOString() });

    const rows = filterAppointments([later, sooner], { ...EMPTY_FILTERS, range: 'all' }, NOW);

    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });
});

describe('nudging', () => {
  it('is offered only while a doctor is the thing being waited on', () => {
    expect(canNudge(appointment({ status: 'pending' }), NOW)).toBe(true);
    for (const status of ['confirmed', 'scheduled', 'completed', 'cancelled'] as const) {
      expect(canNudge(appointment({ status }), NOW)).toBe(false);
    }
  });

  it('holds off until the cooldown has passed', () => {
    const justNudged = appointment({ lastNudgedAt: ago(0.25) });
    const cooledDown = appointment({
      lastNudgedAt: ago(NUDGE_COOLDOWN_MINUTES / 60 + 0.1),
    });

    expect(canNudge(justNudged, NOW)).toBe(false);
    expect(canNudge(cooledDown, NOW)).toBe(true);
  });
});

describe('the action machine', () => {
  const all = { canReassign: true, canCancel: true };

  it('offers nothing but the record on a closed appointment', () => {
    for (const status of ['completed', 'cancelled', 'no-show'] as const) {
      expect(availableActions(appointment({ status }), all, NOW)).toEqual(['view']);
    }
  });

  it('withholds an action the role does not hold', () => {
    const row = appointment({ status: 'confirmed' });

    expect(availableActions(row, all, NOW)).toEqual(['view', 'reassign', 'cancel']);
    expect(availableActions(row, { canReassign: false, canCancel: true }, NOW)).toEqual([
      'view',
      'cancel',
    ]);
    expect(availableActions(row, { canReassign: false, canCancel: false }, NOW)).toEqual(['view']);
  });

  it('adds the nudge only where a nudge would mean something', () => {
    expect(availableActions(appointment({ status: 'pending' }), all, NOW)).toContain('nudge');
    expect(availableActions(appointment({ status: 'confirmed' }), all, NOW)).not.toContain('nudge');
  });
});

describe('reassignment targets', () => {
  const row = appointment({ doctorId: 'doc-a', specialty: 'Cardiology' });

  it('keeps the specialty, drops the incumbent, and respects capacity', () => {
    const roster = [
      doctor({ id: 'doc-a' }), // already holds it
      doctor({ id: 'doc-b' }), // eligible
      doctor({ id: 'doc-c', specialty: 'Endocrinology' }), // wrong specialty
      doctor({ id: 'doc-d', availability: 'unavailable', openSlotsToday: 0 }),
      doctor({ id: 'doc-e', openSlotsToday: 0 }), // available but full
    ];

    expect(eligibleReassignTargets(roster, row).map((entry) => entry.id)).toEqual(['doc-b']);
  });

  it('can return nobody, which the picker has to be able to say', () => {
    expect(eligibleReassignTargets([doctor({ id: 'doc-a' })], row)).toEqual([]);
  });
});

describe('reasons', () => {
  it('rejects empty and token reasons', () => {
    expect(validateReason('').ok).toBe(false);
    expect(validateReason('   ').ok).toBe(false);
    expect(validateReason('sick').ok).toBe(false);
    expect(validateReason('Doctor is on emergency cover all week.').ok).toBe(true);
  });
});

describe('the utilization heatmap', () => {
  /** A local slot builder — the matrix reads wall-clock hours, not UTC. */
  const at = (dayOffset: number, hour: number): string => {
    const date = new Date(NOW + dayOffset * 24 * HOUR);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  it('counts occupied slots and normalises against the busiest cell', () => {
    const busyHour = at(0, 10);
    const { cells, peak, total } = buildHeatmap([
      appointment({ id: '1', startsAt: busyHour, status: 'confirmed' }),
      appointment({ id: '2', startsAt: busyHour, status: 'completed' }),
      appointment({ id: '3', startsAt: at(0, 14), status: 'confirmed' }),
    ]);

    expect(total).toBe(3);
    expect(peak).toBe(2);

    const busyCell = cells.find((cell) => cell.count === 2);
    const quietCell = cells.find((cell) => cell.count === 1);
    expect(busyCell?.intensity).toBe(1);
    expect(quietCell?.intensity).toBe(0.5);
  });

  it('ignores cancellations — they never took the capacity', () => {
    const { total } = buildHeatmap([
      appointment({ id: '1', startsAt: at(0, 10), status: 'cancelled' }),
      appointment({ id: '2', startsAt: at(0, 10), status: 'confirmed' }),
    ]);

    expect(total).toBe(1);
  });

  it('ignores slots outside clinic hours', () => {
    expect(buildHeatmap([appointment({ startsAt: at(0, 3), status: 'confirmed' })]).total).toBe(0);
  });

  it('puts Monday first even though JS weeks start on Sunday', () => {
    // 2026-08-16 is a Sunday; the matrix must place it in the last row.
    const sunday = new Date('2026-08-16T10:00:00.000Z');
    sunday.setHours(10, 0, 0, 0);
    const { cells } = buildHeatmap([
      appointment({ startsAt: sunday.toISOString(), status: 'confirmed' }),
    ]);

    const occupied = cells.find((cell) => cell.count === 1);
    expect(occupied?.weekday).toBe(6);
  });
});
