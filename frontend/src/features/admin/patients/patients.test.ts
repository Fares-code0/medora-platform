import { describe, expect, it } from 'vitest';

import {
  activityBand,
  assignedDoctorNames,
  canDeactivate,
  canReactivate,
  canResetCredentials,
  canRevoke,
  canUnlock,
  DORMANT_DAYS,
  EMPTY_FILTERS,
  filterPatients,
  hasNoActiveAccess,
  matchesFilters,
  openWorkCount,
  RECENT_DAYS,
  summarise,
  validateReason,
} from './patients';
import type { AccessGrant, PatientAccount } from './patients.types';

/**
 * The pure rules behind ADM-04 (UX §3.4).
 *
 * The claims worth pinning down are the ones a UI change could quietly
 * break: that the doctors column is *derived* from live grants rather than
 * stored, that a revoked grant stops counting the moment it is revoked, and
 * that the list leads with the accounts somebody is waiting on.
 */

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-08-12T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function grant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: 'g1',
    granteeId: 'dr-chen',
    granteeName: 'Dr. Amelia Chen',
    granteeRole: 'doctor',
    scope: 'full-record',
    grantedBy: 'Registration',
    grantedAt: daysAgo(100),
    status: 'active',
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    ...overrides,
  };
}

function patient(overrides: Partial<PatientAccount> = {}): PatientAccount {
  return {
    id: 'PT-1001',
    name: 'Khaled Nassar',
    mrn: '4411-27',
    email: 'khaled.nassar@example.test',
    phone: '+20 100 214 3387',
    dateOfBirth: '1974-03-18',
    status: 'active',
    lockCause: null,
    registeredAt: daysAgo(700),
    lastActivityAt: daysAgo(1),
    assignedDoctors: [],
    deactivationReason: null,
    grants: [],
    accessRequests: [],
    events: [],
    flags: [],
    ...overrides,
  };
}

describe('account lifecycle', () => {
  it('only offers unlocking on a locked account', () => {
    expect(canUnlock(patient({ status: 'locked' }))).toBe(true);
    expect(canUnlock(patient({ status: 'active' }))).toBe(false);
    expect(canUnlock(patient({ status: 'inactive' }))).toBe(false);
  });

  it('lets a locked account be deactivated without unlocking it first', () => {
    // A support hold that turns out to be a compromised account should be
    // closable directly, not via a detour through "make it usable again".
    expect(canDeactivate(patient({ status: 'locked' }))).toBe(true);
    expect(canDeactivate(patient({ status: 'inactive' }))).toBe(false);
    expect(canReactivate(patient({ status: 'inactive' }))).toBe(true);
  });

  it('refuses to send a reset link to a deactivated account', () => {
    // Mail that provably cannot be acted on is worse than no offer at all.
    expect(canResetCredentials(patient({ status: 'inactive' }))).toBe(false);
    expect(canResetCredentials(patient({ status: 'locked' }))).toBe(true);
  });

  it('requires a real reason, not a token one', () => {
    expect(validateReason('').ok).toBe(false);
    expect(validateReason('closed').ok).toBe(false);
    expect(validateReason('Closure requested by the patient.').ok).toBe(true);
  });
});

describe('the access grid', () => {
  it('derives the doctors column from live grants only', () => {
    const record = patient({
      grants: [
        grant({ id: 'a', granteeName: 'Dr. Amelia Chen' }),
        grant({ id: 'b', granteeName: 'Dr. Omar Khalil', status: 'revoked' }),
        grant({ id: 'c', granteeName: 'Medora Laboratory', granteeRole: 'laboratory' }),
      ],
      // A stale stored value that disagrees with the grants.
      assignedDoctors: ['Dr. Amelia Chen', 'Dr. Omar Khalil'],
    });

    // Revoked doctors drop out; non-doctors never counted.
    expect(assignedDoctorNames(record)).toEqual(['Dr. Amelia Chen']);
  });

  it('treats a record whose grants are all revoked as unreachable', () => {
    expect(hasNoActiveAccess(patient({ grants: [grant({ status: 'revoked' })] }))).toBe(true);
    expect(hasNoActiveAccess(patient({ grants: [grant()] }))).toBe(false);
  });

  it('will not revoke the same grant twice', () => {
    expect(canRevoke(grant())).toBe(true);
    expect(canRevoke(grant({ status: 'revoked' }))).toBe(false);
  });
});

describe('filtering', () => {
  it('finds a row by phone number typed without punctuation', () => {
    // An administrator reading a number off a support ticket has not got
    // the spaces and brackets.
    const record = patient();
    expect(matchesFilters(record, { ...EMPTY_FILTERS, query: '2143387' }, NOW)).toBe(true);
    expect(matchesFilters(record, { ...EMPTY_FILTERS, query: '9999999' }, NOW)).toBe(false);
  });

  it('searches the underlying values even though the table is masked', () => {
    const record = patient();
    expect(matchesFilters(record, { ...EMPTY_FILTERS, query: 'khaled' }, NOW)).toBe(true);
    expect(matchesFilters(record, { ...EMPTY_FILTERS, query: 'PT-1001' }, NOW)).toBe(true);
  });

  it('filters by the doctor who actually holds access', () => {
    const record = patient({ grants: [grant({ granteeName: 'Dr. Omar Khalil' })] });
    expect(
      matchesFilters(record, { ...EMPTY_FILTERS, doctor: 'Dr. Omar Khalil' }, NOW),
    ).toBe(true);
    expect(
      matchesFilters(record, { ...EMPTY_FILTERS, doctor: 'Dr. Amelia Chen' }, NOW),
    ).toBe(false);
  });

  it('bands activity by last recorded action', () => {
    expect(activityBand(patient({ lastActivityAt: daysAgo(2) }), NOW)).toBe('recent');
    expect(activityBand(patient({ lastActivityAt: daysAgo(RECENT_DAYS + 5) }), NOW)).toBe('quiet');
    expect(activityBand(patient({ lastActivityAt: daysAgo(DORMANT_DAYS + 5) }), NOW)).toBe(
      'dormant',
    );
  });

  it('leads with the accounts somebody is waiting on', () => {
    const rows = filterPatients(
      [
        patient({ id: 'PT-3', name: 'Zara Quiet' }),
        patient({
          id: 'PT-2',
          name: 'Bilal Flagged',
          flags: [{ id: 'f', kind: 'billing', summary: 'x', openedAt: daysAgo(1) }],
        }),
        patient({ id: 'PT-1', name: 'Yusuf Locked', status: 'locked' }),
      ],
      EMPTY_FILTERS,
      NOW,
    );

    // Locked (cannot sign in) first, then open work, then the rest.
    expect(rows.map((row) => row.id)).toEqual(['PT-1', 'PT-2', 'PT-3']);
  });

  it('ranks a pending access request as work, exactly like a support flag', () => {
    // Caught in the browser: the "open issues" column counted flags AND
    // requests while the ordering ranked on flags alone, so a row showing
    // "1" sorted below rows showing nothing.
    const rows = filterPatients(
      [
        patient({ id: 'PT-2', name: 'Aaron Quiet' }),
        patient({
          id: 'PT-1',
          name: 'Zoe Requested',
          accessRequests: [
            {
              id: 'r',
              requesterId: 'dr-x',
              requesterName: 'Dr. X',
              requesterRole: 'doctor',
              scope: 'summary',
              requestedAt: daysAgo(1),
              reason: 'covering',
            },
          ],
        }),
      ],
      EMPTY_FILTERS,
      NOW,
    );

    // Zoe sorts first despite losing the alphabetical tiebreak.
    expect(rows.map((row) => row.id)).toEqual(['PT-1', 'PT-2']);
    expect(openWorkCount(rows[0] as PatientAccount)).toBe(1);
  });
});

describe('the open-issues filter', () => {
  it('is off by default', () => {
    expect(EMPTY_FILTERS.openWork).toBe(false);
  });

  it('keeps exactly the accounts the overview queue counts', () => {
    const waiting = patient({
      id: 'waiting',
      flags: [{ id: 'f1', kind: 'data-correction', summary: 'Wrong DOB', openedAt: daysAgo(1) }],
    });
    const settled = patient({ id: 'settled' });

    const kept = filterPatients([waiting, settled], { ...EMPTY_FILTERS, openWork: true }, NOW);

    expect(kept.map((p) => p.id)).toEqual(['waiting']);
  });
});

describe('the summary strip', () => {
  it('counts the two things an administrator can act on', () => {
    const summary = summarise([
      patient({ id: 'PT-1', status: 'locked' }),
      patient({
        id: 'PT-2',
        flags: [{ id: 'f', kind: 'access', summary: 'x', openedAt: daysAgo(1) }],
        accessRequests: [
          {
            id: 'r',
            requesterId: 'dr-x',
            requesterName: 'Dr. X',
            requesterRole: 'doctor',
            scope: 'summary',
            requestedAt: daysAgo(1),
            reason: 'covering',
          },
        ],
      }),
      patient({ id: 'PT-3', status: 'inactive' }),
    ]);

    expect(summary).toEqual({
      total: 3,
      locked: 1,
      inactive: 1,
      openIssues: 1,
      pendingRequests: 1,
    });
  });
});
