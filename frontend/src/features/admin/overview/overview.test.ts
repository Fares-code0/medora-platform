import { describe, expect, it } from 'vitest';

import { routes } from '@/routes';

import type { AuditEvent, PhiAccessEvent } from '../administration.types';
import { summarize } from '../appointments/oversight';
import type { OversightAppointment, PlatformDoctor } from '../appointments/oversight.types';
import type { SafetyFlag } from '../communications/communications.types';
import { licenceExpiringSoon, LICENCE_EXPIRY_DAYS } from '../doctors/doctors';
import type { CredentialDocument, DoctorRecord } from '../doctors/doctors.types';
import { openWorkCount } from '../patients/patients';
import type { PatientAccount } from '../patients/patients.types';

import {
  ALERT_WINDOW_DAYS,
  alertDestination,
  deriveActionQueue,
  deriveFunnel,
  deriveKpis,
  deriveSecurityAlerts,
  deriveSignups,
  FAILED_SIGN_IN_THRESHOLD,
  FLAGGED_COMMS_THRESHOLD,
  isFreshDeployment,
  PHI_BURST_THRESHOLD,
  SIGNUP_FEED_LIMIT,
} from './overview';

/**
 * The pure rules behind ADM-01 (UX §3.1).
 *
 * The claims worth pinning down are the ones a later UI change could
 * quietly break: that a queue count equals what its linked page shows for
 * the same filter, that the funnel's first stage and its two rates share one
 * denominator, that every alert kind has somewhere real to go, and that
 * thresholds fire *at* the boundary and not below it.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NOW = Date.parse('2026-08-12T12:00:00.000Z');

const daysAgo = (days: number): string => new Date(NOW - days * DAY_MS).toISOString();
const hoursAgo = (hours: number): string => new Date(NOW - hours * HOUR_MS).toISOString();
const daysAhead = (days: number): string => new Date(NOW + days * DAY_MS).toISOString();

function doctor(overrides: Partial<DoctorRecord> = {}): DoctorRecord {
  return {
    id: 'dr-chen',
    name: 'Dr. Amelia Chen',
    title: 'Consultant',
    email: 'chen@medora.health',
    phone: '+1 555 0100',
    specialty: 'Cardiology',
    licenseNumber: 'LIC-1',
    languages: ['English'],
    bio: '',
    joinedAt: daysAgo(400),
    lastActiveAt: daysAgo(1),
    verification: 'verified',
    verificationNote: null,
    account: 'active',
    suspensionReason: null,
    administrative: { roleTemplate: 'Doctor', clinic: 'Main' },
    patientsCount: 10,
    appointments30d: 20,
    rating: null,
    licenseExpiresAt: null,
    documents: [],
    logins: [],
    activity: {
      recordsEdited: 0,
      prescriptionsIssued: 0,
      labsReviewed: 0,
      messagesSent: 0,
      windowDays: 30,
    },
    statistics: {
      patientsServed: 0,
      rating: 4.5,
      ratingDistribution: [0, 0, 0, 0, 0],
      avgResponseHours: 2,
      monthlyVolume: [],
    },
    audit: [],
    ...overrides,
  };
}

function patient(overrides: Partial<PatientAccount> = {}): PatientAccount {
  return {
    id: 'pt-1',
    name: 'Sofia Marino',
    mrn: 'MRN-1',
    email: 'sofia@example.com',
    phone: '+1 555 0111',
    dateOfBirth: '1980-01-01',
    status: 'active',
    lockCause: null,
    registeredAt: daysAgo(10),
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

function appointment(overrides: Partial<OversightAppointment> = {}): OversightAppointment {
  return {
    id: 'ap-1',
    reference: 'APT-1',
    startsAt: daysAgo(1),
    durationMin: 30,
    visitType: 'Follow-up',
    department: 'Cardiology',
    specialty: 'Cardiology',
    doctorId: 'dr-chen',
    doctorName: 'Dr. Amelia Chen',
    patientId: 'pt-1',
    patientName: 'Sofia Marino',
    patientMrn: 'MRN-1',
    status: 'completed',
    stateSince: daysAgo(1),
    rescheduleCount: 0,
    complaint: null,
    lastNudgedAt: null,
    events: [],
    notifications: [],
    ...overrides,
  };
}

function flag(overrides: Partial<SafetyFlag> = {}): SafetyFlag {
  return {
    id: 'flag-1',
    conversationId: 'cv-1',
    messageId: 'msg-1',
    category: 'emergency-language',
    source: 'auto',
    excerpt: 'placeholder',
    authorLabel: 'Patient',
    at: daysAgo(1),
    status: 'open',
    resolution: null,
    note: null,
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

const roster: readonly PlatformDoctor[] = [
  {
    id: 'dr-chen',
    name: 'Dr. Amelia Chen',
    specialty: 'Cardiology',
    department: 'Cardiology',
    availability: 'available',
    openSlotsToday: 3,
    loadPercent: 60,
    note: null,
  },
  {
    id: 'dr-okafor',
    name: 'Dr. Ben Okafor',
    specialty: 'Neurology',
    department: 'Neurology',
    availability: 'unavailable',
    openSlotsToday: 0,
    loadPercent: 0,
    note: 'On leave',
  },
];

describe('deriveKpis', () => {
  it('counts verified doctors and quotes only admin-actionable pending ones', () => {
    const doctors = [
      doctor({ id: 'a', verification: 'verified' }),
      doctor({ id: 'b', verification: 'pending' }),
      // Waiting on the doctor, not on an administrator — must not be quoted.
      doctor({ id: 'c', verification: 'docs-requested' }),
    ];

    const kpis = deriveKpis(doctors, [], [], roster, NOW);

    expect(kpis.verifiedDoctors).toBe(1);
    expect(kpis.pendingVerifications).toBe(1);
  });

  it('averages utilization over doctors who are taking appointments at all', () => {
    // dr-okafor is unavailable, so averaging them in would report 30%
    // utilization for a clinic running at 60%.
    const kpis = deriveKpis([], [], [], roster, NOW);

    expect(kpis.utilizationPercent).toBe(60);
  });

  it('reports zero utilization rather than dividing by zero with no roster', () => {
    expect(deriveKpis([], [], [], [], NOW).utilizationPercent).toBe(0);
  });
});

describe('deriveActionQueue', () => {
  it('counts pending verifications and links to the tab that shows them', () => {
    const doctors = [
      doctor({ id: 'a', verification: 'pending' }),
      doctor({ id: 'b', verification: 'docs-requested' }),
    ];

    const row = deriveActionQueue(doctors, [], [], NOW).find((r) => r.kind === 'verifications');

    expect(row?.count).toBe(1);
    expect(row?.to).toBe('/admin/doctors?tab=pending');
  });

  it('counts licences by ADM-02’s own rule and links with a flag, not a number', () => {
    const licence = (expiresAt: string): CredentialDocument => ({
      id: 'd1',
      kind: 'medical-license',
      filename: 'licence.pdf',
      uploadedAt: daysAgo(200),
      expiresAt,
      decision: 'approved',
      checklist: { authentic: true, current: true, matchesIdentity: true },
      rejectionReason: null,
      reviewedBy: 'Marcus Reed',
      reviewedAt: daysAgo(199),
      previewLines: [],
    });
    const doctors = [
      doctor({ id: 'soon', documents: [licence(daysAhead(LICENCE_EXPIRY_DAYS - 1))] }),
      doctor({ id: 'later', documents: [licence(daysAhead(LICENCE_EXPIRY_DAYS + 1))] }),
    ];

    const row = deriveActionQueue(doctors, [], [], NOW).find((r) => r.kind === 'licence-expiries');

    expect(row?.count).toBe(doctors.filter((d) => licenceExpiringSoon(d, NOW)).length);
    expect(row?.count).toBe(1);
    // A flag: the horizon is the constant on both sides, so a number in the
    // URL would name a window the destination never reads.
    expect(row?.to).toBe('/admin/doctors?expiring=soon');
  });

  it('counts accounts by ADM-04’s own open-work rule, not a second one', () => {
    const patients = [
      patient({
        id: 'p1',
        flags: [{ id: 'f1', kind: 'data-correction', summary: 'Wrong DOB', openedAt: daysAgo(2) }],
      }),
      patient({ id: 'p2' }),
      // Must verify the count includes open access requests, not just flags.
      patient({
        id: 'p3',
        accessRequests: [
          {
            id: 'ar1',
            requesterId: 'dr-khalil',
            requesterName: 'Dr. Khalil',
            requesterRole: 'doctor',
            scope: 'full-record',
            requestedAt: daysAgo(1),
            reason: 'Patient treatment authorization needed',
          },
        ],
      }),
    ];

    const row = deriveActionQueue([], patients, [], NOW).find((r) => r.kind === 'patient-flags');

    // The guard against the count and its destination drifting apart: both
    // sides must be `openWorkCount(...) > 0` and nothing else.
    expect(row?.count).toBe(patients.filter((p) => openWorkCount(p) > 0).length);
    // …and the independent anchor the derived assertion cannot supply: it
    // computes the expectation with the expression under test, so a rule that
    // counted only flags — dropping p3's open access request — would satisfy
    // both sides of it. Two of the three fixtures above have open work.
    expect(row?.count).toBe(2);
    expect(row?.to).toBe('/admin/patients?flag=open');
  });

  it('agrees with summarize() about how many appointments are stuck', () => {
    const appointments = [
      appointment({ id: 'a', status: 'pending', stateSince: daysAgo(3) }),
      appointment({ id: 'b', status: 'pending', stateSince: hoursAgo(2) }),
    ];

    const row = deriveActionQueue([], [], appointments, NOW).find(
      (r) => r.kind === 'stuck-appointments',
    );

    expect(row?.count).toBe(summarize(appointments, NOW).pendingOverThreshold);
    // The anchor beside it, for the same reason as the row above: only one of
    // the two pending appointments has been pending past the threshold, so a
    // count that fell back to "every pending appointment" would agree with the
    // derived assertion and disagree with this one.
    expect(row?.count).toBe(1);
    expect(row?.to).toBe('/admin/appointments?flag=stuck-pending');
  });

  it('counts only open safety flags, derived from the communications document already in the cache', () => {
    const flags = [
      flag({ id: 'f1', status: 'open' }),
      flag({ id: 'f2', status: 'under-review' }),
      flag({ id: 'f3', status: 'resolved' }),
    ];

    const row = deriveActionQueue([], [], [], NOW, flags).find(
      (r) => r.kind === 'flagged-communications',
    );

    // The independent anchor: a rule that counted every flag regardless of
    // status would also satisfy a derived `flags.length` assertion, so this
    // is written against the literal count instead.
    expect(row?.count).toBe(1);
    expect(row?.to).toBe('/admin/communications?tab=flags&status=open');
  });

  it('defaults to no flagged-communications work when the caller passes none', () => {
    // The fifth row must not silently vanish for a caller that has not
    // wired the communications document through yet — it reads as zero
    // open flags, not as a missing row.
    const row = deriveActionQueue([], [], [], NOW).find(
      (r) => r.kind === 'flagged-communications',
    );

    expect(row?.count).toBe(0);
  });
});

describe('deriveSecurityAlerts', () => {
  const failedLogins = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `l${String(index)}`,
      at: daysAgo(1),
      ip: '10.0.0.1',
      device: 'Chrome',
      location: 'Berlin',
      result: 'failed' as const,
      impossibleTravel: false,
    }));

  it('fires at the failed sign-in threshold and not one below it', () => {
    const below = doctor({ logins: failedLogins(FAILED_SIGN_IN_THRESHOLD - 1) });
    const at = doctor({ logins: failedLogins(FAILED_SIGN_IN_THRESHOLD) });

    expect(deriveSecurityAlerts([below], [], [], NOW)).toHaveLength(0);
    expect(deriveSecurityAlerts([at], [], [], NOW)).toHaveLength(1);
  });

  it('treats impossible travel as critical', () => {
    const flagged = doctor({
      logins: [
        {
          id: 'l1',
          at: daysAgo(1),
          ip: '10.0.0.1',
          device: 'Chrome',
          location: 'Tokyo',
          result: 'success',
          impossibleTravel: true,
        },
      ],
    });

    const [alert] = deriveSecurityAlerts([flagged], [], [], NOW);

    expect(alert?.kind).toBe('impossible-travel');
    expect(alert?.severity).toBe('critical');
  });

  it('raises one burst alert per actor, not one per reveal', () => {
    const log: readonly PhiAccessEvent[] = Array.from(
      { length: PHI_BURST_THRESHOLD },
      (_, index) => ({
        id: `e${String(index)}`,
        actor: 'Marcus Reed',
        subjectId: `pt-${String(index)}`,
        subjectLabel: `Patient ${String(index)}`,
        category: 'clinical-review',
        reason: 'Reviewing a complaint thread end to end',
        at: hoursAgo(1),
        durationMinutes: 15,
      }),
    );

    const alerts = deriveSecurityAlerts([], log, [], NOW);

    expect(alerts.filter((a) => a.kind === 'phi-burst')).toHaveLength(1);
  });

  it('ignores audit events older than the alert window', () => {
    const stale: readonly AuditEvent[] = [
      {
        id: 'a1',
        actor: 'Marcus Reed',
        action: 'Permission matrix saved',
        target: 'Roles',
        at: daysAgo(ALERT_WINDOW_DAYS + 1),
        severity: 'critical',
      },
    ];

    expect(deriveSecurityAlerts([], [], stale, NOW)).toHaveLength(0);
  });

  it('fires a flagged-communications alert at the open-flag threshold and not one below it', () => {
    const below = Array.from({ length: FLAGGED_COMMS_THRESHOLD - 1 }, (_, i) =>
      flag({ id: `f${String(i)}`, status: 'open' }),
    );
    const at = Array.from({ length: FLAGGED_COMMS_THRESHOLD }, (_, i) =>
      flag({ id: `f${String(i)}`, status: 'open' }),
    );

    expect(
      deriveSecurityAlerts([], [], [], NOW, below).filter((a) => a.kind === 'flagged-communications'),
    ).toHaveLength(0);
    expect(
      deriveSecurityAlerts([], [], [], NOW, at).filter((a) => a.kind === 'flagged-communications'),
    ).toHaveLength(1);
  });

  it('counts only open flags toward the flagged-communications alert', () => {
    // Anchor against the literal count so a rule counting every status
    // (open, under-review, resolved) alike would fail this even though it
    // would still pass the threshold test above.
    const flags = [
      ...Array.from({ length: FLAGGED_COMMS_THRESHOLD }, (_, i) =>
        flag({ id: `open-${String(i)}`, status: 'under-review' }),
      ),
    ];

    expect(
      deriveSecurityAlerts([], [], [], NOW, flags).filter((a) => a.kind === 'flagged-communications'),
    ).toHaveLength(0);
  });

  it('orders critical alerts ahead of warnings', () => {
    const doctors = [
      doctor({ id: 'a', logins: failedLogins(FAILED_SIGN_IN_THRESHOLD) }),
      doctor({
        id: 'b',
        logins: [
          {
            id: 'l1',
            at: daysAgo(2),
            ip: '10.0.0.2',
            device: 'Safari',
            location: 'Tokyo',
            result: 'success',
            impossibleTravel: true,
          },
        ],
      }),
    ];

    const alerts = deriveSecurityAlerts(doctors, [], [], NOW);

    expect(alerts[0]?.severity).toBe('critical');
  });
});

describe('alertDestination', () => {
  it('sends a doctor’s failed sign-ins to that doctor’s activity tab', () => {
    // The doctor page is still the better answer for *one named doctor*: it
    // carries the sign-in history with impossible-travel already flagged.
    const to = alertDestination({
      id: 'x',
      kind: 'failed-sign-ins',
      severity: 'warning',
      summary: '',
      at: daysAgo(1),
      subjectId: 'dr-chen',
    });

    expect(to).toBe('/admin/doctors/dr-chen?tab=activity');
  });

  it('sends the alerts the log answers better into the log, filtered', () => {
    // ADM-07 landed, so these no longer route to the nearest stand-in. Each
    // arrives at /admin/logs already narrowed to its own evidence.
    const at = daysAgo(1);

    expect(
      alertDestination({
        id: 'x',
        kind: 'impossible-travel',
        severity: 'critical',
        summary: '',
        at,
        subjectId: 'dr-chen',
      }),
    ).toBe(`${routes.admin.logs}?type=impossible-travel`);

    expect(
      alertDestination({
        id: 'x',
        kind: 'critical-audit',
        severity: 'critical',
        summary: '',
        at,
        subjectId: null,
      }),
    ).toBe(`${routes.admin.logs}?severity=critical`);
  });

  it('gives every alert kind a real destination', () => {
    const kinds = [
      'failed-sign-ins',
      'impossible-travel',
      'phi-burst',
      'critical-audit',
      'flagged-communications',
    ] as const;

    for (const kind of kinds) {
      const to = alertDestination({
        id: 'x',
        kind,
        severity: 'warning',
        summary: '',
        at: daysAgo(1),
        subjectId: 'dr-chen',
      });
      expect(to.startsWith('/admin/')).toBe(true);
    }
  });

  it('sends a flagged-communications alert to the same open-flags queue the action-queue row uses', () => {
    const to = alertDestination({
      id: 'flagged-communications',
      kind: 'flagged-communications',
      severity: 'warning',
      summary: '',
      at: daysAgo(1),
      subjectId: null,
    });

    expect(to).toBe('/admin/communications?tab=flags&status=open');
  });

  it('falls back to the log when a sign-in alert names no doctor', () => {
    // Without a subject there is no doctor page to open, and the unfiltered
    // doctors list answers nothing — the log filtered to failed sign-ins does.
    const to = alertDestination({
      id: 'x',
      kind: 'failed-sign-ins',
      severity: 'warning',
      summary: '',
      at: daysAgo(1),
      subjectId: null,
    });

    expect(to).toBe(`${routes.admin.logs}?type=login-failed`);
  });
});

describe('deriveFunnel', () => {
  // `deriveFunnel`'s own `within` (overview.ts) and `summarize`'s
  // `withinLastDays` (appointments/oversight.ts) are structurally identical
  // today — both `at <= now && at >= now - 7*DAY_MS` — but they are two
  // separate implementations, and every appointment below used to sit at
  // `daysAgo(1)`, well clear of the 7-day edge either one draws. That left
  // the boundary itself unguarded: a drift confined to the edge, such as
  // `summarize` widening to the "next & last 7 days" semantics
  // `DATE_RANGE_LABEL['7d']` already names elsewhere in oversight.ts, would
  // slip past a fixture that never touches the edge. These three appointments
  // straddle it on purpose:
  //  - id '6' sits exactly at `now - 7*DAY_MS`, the inclusive edge (`>=`) —
  //    just inside the window on both implementations today.
  //  - id '7' sits one millisecond further into the past — just outside the
  //    window on both implementations today.
  //  - id '8' sits one day into the future — outside the window on both
  //    implementations today (neither admits future dates yet), which is
  //    exactly the case a "next & last 7 days" drift in one of them, but not
  //    the other, would flip.
  const atBoundary = new Date(NOW - 7 * DAY_MS).toISOString();
  const justPastBoundary = new Date(NOW - 7 * DAY_MS - 1).toISOString();
  const oneDayAhead = new Date(NOW + DAY_MS).toISOString();

  const appointments = [
    appointment({ id: '1', status: 'completed' }),
    appointment({ id: '2', status: 'confirmed' }),
    appointment({ id: '3', status: 'pending' }),
    appointment({ id: '4', status: 'cancelled' }),
    appointment({ id: '5', status: 'no-show' }),
    appointment({ id: '6', status: 'confirmed', startsAt: atBoundary }),
    appointment({ id: '7', status: 'confirmed', startsAt: justPastBoundary }),
    appointment({ id: '8', status: 'confirmed', startsAt: oneDayAhead }),
  ];

  it('shares one denominator with the rates quoted beside it, including at the 7-day edge', () => {
    const funnel = deriveFunnel(appointments, NOW);
    const summary = summarize(appointments, NOW);

    // Positive control: id '6' (at the inclusive edge) must actually be
    // counted, and ids '7' and '8' must actually be excluded — otherwise the
    // equality below would hold trivially without the boundary fixture
    // having exercised anything.
    expect(funnel.window7dTotal).toBe(6);

    expect(funnel.stages[0]?.value).toBe(summary.window7dTotal);
    expect(funnel.window7dTotal).toBe(summary.window7dTotal);
    expect(funnel.cancellationRate7d).toBe(summary.cancellationRate7d);
    expect(funnel.noShowRate7d).toBe(summary.noShowRate7d);
  });

  it('narrows monotonically from requested to completed', () => {
    const values = deriveFunnel(appointments, NOW).stages.map((stage) => stage.value);

    expect(values[0]).toBeGreaterThanOrEqual(values[1] ?? 0);
    expect(values[1]).toBeGreaterThanOrEqual(values[2] ?? 0);
  });

  it('reports an empty window rather than three zeros with no explanation', () => {
    const funnel = deriveFunnel([], NOW);

    expect(funnel.window7dTotal).toBe(0);
    expect(funnel.cancellationRate7d).toBe(0);
  });
});

describe('deriveSignups', () => {
  it('merges doctors and patients newest first', () => {
    const entries = deriveSignups(
      [doctor({ id: 'd1', joinedAt: daysAgo(5) })],
      [patient({ id: 'p1', registeredAt: daysAgo(1) })],
    );

    expect(entries.map((entry) => entry.id)).toEqual(['p1', 'd1']);
  });

  it('tags each entry with the role that decides whether it is masked', () => {
    const entries = deriveSignups([doctor({ id: 'd1' })], [patient({ id: 'p1' })]);

    expect(entries.find((entry) => entry.id === 'p1')?.role).toBe('patient');
    expect(entries.find((entry) => entry.id === 'd1')?.role).toBe('doctor');
  });

  it('caps the feed', () => {
    const patients = Array.from({ length: SIGNUP_FEED_LIMIT + 3 }, (_, index) =>
      patient({ id: `p${String(index)}`, registeredAt: daysAgo(index) }),
    );

    expect(deriveSignups([], patients)).toHaveLength(SIGNUP_FEED_LIMIT);
  });
});

describe('isFreshDeployment', () => {
  it('is true only with no doctors and no patients', () => {
    expect(isFreshDeployment([], [])).toBe(true);
    expect(isFreshDeployment([doctor()], [])).toBe(false);
    expect(isFreshDeployment([], [patient()])).toBe(false);
  });
});
