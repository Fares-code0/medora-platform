import { afterEach, describe, expect, it } from 'vitest';

import type { AuditEvent, PhiAccessEvent } from '../administration.types';
import type { OversightAppointment, OversightEventKind } from '../appointments/oversight.types';
import type { ContentAccessEntry } from '../communications/communications.types';
import type { DoctorRecord, LoginEvent } from '../doctors/doctors.types';
import type { AccountEventKind, PatientAccount } from '../patients/patients.types';

import {
  ALL_EVENT_TYPES,
  CATEGORY_LABEL,
  EMPTY_FILTERS,
  EVENT_TYPE_LABEL,
  TYPE_CATEGORY,
  classifyAuditAction,
  filterEvents,
  formatTimestamp,
  fromAppointmentEvents,
  fromContentAccess,
  fromDoctorAudit,
  fromDoctorLogins,
  fromLegacyAudit,
  fromPatientEvents,
  fromPhiAccess,
  pivotOn,
  projectAuditFeed,
  toAuditEvent,
  toDateTimeLocalValue,
} from './logs';
import type { LogCategory, LogEvent, LogEventType } from './logs.types';

/**
 * The taxonomy behind ADM-07 (UX §3.7).
 *
 * The invariant worth pinning is that the type→category map is total and
 * single-valued: an unclassified event type would vanish from the
 * event-type filter, and a type in two categories would make the
 * `getAuditEvents()` projection ambiguous.
 */

describe('the taxonomy', () => {
  it('classifies every event type into exactly one category', () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(TYPE_CATEGORY[type]).toBeDefined();
    }
  });

  it('agrees with TYPE_CATEGORY in both directions', () => {
    // ALL_EVENT_TYPES is written independently of TYPE_CATEGORY (see logs.ts),
    // specifically so the two can drift and a test can catch it. One
    // direction alone isn't enough: a type dropped from the map but left in
    // the list would fail the totality test above, but a type dropped from
    // the list while still keyed in the map would fail neither test unless
    // checked here.
    const mapKeys = Object.keys(TYPE_CATEGORY);
    for (const type of ALL_EVENT_TYPES) {
      expect(mapKeys).toContain(type);
    }
    for (const key of mapKeys) {
      expect(ALL_EVENT_TYPES).toContain(key);
    }
  });

  it('labels every event type', () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(EVENT_TYPE_LABEL[type]).toBeTruthy();
    }
  });

  it('covers all five §3.7 categories', () => {
    const categories = new Set<LogCategory>(ALL_EVENT_TYPES.map((t) => TYPE_CATEGORY[t]));
    expect([...categories].sort()).toEqual([
      'admin-activity',
      'authentication',
      'security',
      'system',
      'user-action',
    ]);
  });

  it('labels every category', () => {
    for (const category of Object.keys(CATEGORY_LABEL) as LogCategory[]) {
      expect(CATEGORY_LABEL[category]).toBeTruthy();
    }
  });

  it('classifies a gated content read as a security event', () => {
    expect(TYPE_CATEGORY['communication-content-accessed']).toBe('security');
  });

  it('lists the content-access type among all event types', () => {
    expect(ALL_EVENT_TYPES).toContain('communication-content-accessed');
  });

  it('places representative types in the correct category', () => {
    // Totality (above) only proves every type lands *somewhere*; it can't
    // catch a type landing in the *wrong* category — remapping
    // 'login-succeeded' to 'security' is still a total, single-valued map.
    // These pins check actual category values for one type per category,
    // plus every 'login-*' type, so a plausible mis-mapping fails a test.
    expect(TYPE_CATEGORY['login-succeeded']).toBe('authentication');
    expect(TYPE_CATEGORY['login-failed']).toBe('authentication');
    expect(TYPE_CATEGORY['login-blocked']).toBe('authentication');

    expect(TYPE_CATEGORY['phi-revealed']).toBe('security');
    expect(TYPE_CATEGORY['impossible-travel']).toBe('security');

    expect(TYPE_CATEGORY['data-export']).toBe('admin-activity');
    expect(TYPE_CATEGORY['doctor-suspended']).toBe('admin-activity');

    expect(TYPE_CATEGORY['job-completed']).toBe('system');
    expect(TYPE_CATEGORY['service-degraded']).toBe('system');

    expect(TYPE_CATEGORY['appointment-confirmed']).toBe('user-action');
  });
});

/* ── Classification fixtures ──────────────────────────────────── */

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const DAY_MS = 86_400_000;
const daysAgo = (d: number): string => new Date(NOW - d * DAY_MS).toISOString();

const login = (overrides: Partial<LoginEvent> = {}): LoginEvent => ({
  id: 'l1',
  at: daysAgo(1),
  ip: '10.0.0.1',
  device: 'Chrome',
  location: 'Berlin',
  result: 'failed',
  impossibleTravel: false,
  ...overrides,
});

const BASE_DOCTOR: DoctorRecord = {
  id: 'doc-1',
  name: 'Dr. Amelia Chen',
  title: 'Consultant Cardiologist',
  email: 'amelia.chen@medora.health',
  phone: '+49 30 555 0100',
  specialty: 'Cardiology',
  licenseNumber: 'LIC-88213',
  languages: ['English', 'German'],
  bio: 'Interventional cardiology, twelve years.',
  joinedAt: daysAgo(400),
  lastActiveAt: daysAgo(1),
  verification: 'verified',
  verificationNote: null,
  account: 'active',
  suspensionReason: null,
  administrative: { roleTemplate: 'Senior clinician', clinic: 'Mitte' },
  patientsCount: 194,
  appointments30d: 62,
  rating: null,
  licenseExpiresAt: null,
  documents: [],
  logins: [],
  activity: {
    recordsEdited: 14,
    prescriptionsIssued: 9,
    labsReviewed: 21,
    messagesSent: 30,
    windowDays: 30,
  },
  statistics: {
    patientsServed: 194,
    rating: 4.6,
    ratingDistribution: [1, 2, 5, 30, 88],
    avgResponseHours: 3.5,
    monthlyVolume: [{ label: 'Jul', value: 62 }],
  },
  audit: [
    {
      id: 'a1',
      at: daysAgo(2),
      actor: 'Marcus Reed',
      action: 'Account suspended',
      detail: 'Licence expired without renewal.',
    },
  ],
};

const doctorWith = (logins: readonly LoginEvent[]): DoctorRecord => ({ ...BASE_DOCTOR, logins });

const doctorWithLogins = doctorWith([login()]);
const doctorWithImpossibleTravel = doctorWith([login({ result: 'success', impossibleTravel: true })]);

/**
 * Names that must never reach a rendered field. Real roster names plus the
 * one planted in `phiEvent.reason`, which is the field an administrator types
 * freehand and therefore the likeliest place a name gets in.
 */
const FORBIDDEN_NAMES = ['Layla Mansour', 'Khaled Nassar', 'Ahmed Nabil'];

const patientWithEvents: PatientAccount = {
  id: 'PT-1002',
  name: 'Layla Mansour',
  mrn: 'MRN-4471',
  email: 'l.mansour@example.com',
  phone: '+49 30 555 0199',
  dateOfBirth: '1984-03-11',
  status: 'locked',
  lockCause: 'failed-sign-ins',
  registeredAt: daysAgo(300),
  lastActivityAt: daysAgo(1),
  assignedDoctors: ['Dr. Amelia Chen'],
  deactivationReason: null,
  grants: [],
  accessRequests: [],
  events: [
    { id: 'e1', at: daysAgo(1), kind: 'account-locked', detail: 'Five consecutive failed sign-ins' },
    {
      id: 'e2',
      at: daysAgo(2),
      kind: 'account-unlocked',
      detail: 'Lock cleared by an administrator',
      actor: 'Marcus Reed',
    },
    { id: 'e3', at: daysAgo(7), kind: 'messages-sent', detail: 'To the care team', count: 4 },
  ],
  flags: [],
};

const appointmentWithEvents: OversightAppointment = {
  id: 'apt-1',
  reference: 'APT-2418',
  startsAt: daysAgo(1),
  durationMin: 30,
  visitType: 'Follow-up',
  department: 'Cardiology',
  specialty: 'Cardiology',
  doctorId: 'doc-1',
  doctorName: 'Dr. Amelia Chen',
  patientId: 'PT-1001',
  patientName: 'Khaled Nassar',
  patientMrn: 'MRN-1188',
  status: 'confirmed',
  stateSince: daysAgo(1),
  rescheduleCount: 0,
  complaint: null,
  lastNudgedAt: null,
  events: [
    {
      id: 'oe1',
      kind: 'confirmed',
      at: daysAgo(1),
      actor: 'Dr. Amelia Chen',
      actorRole: 'doctor',
      detail: 'Slot accepted.',
    },
    {
      id: 'oe2',
      kind: 'requested',
      at: daysAgo(3),
      actor: 'Patient',
      actorRole: 'patient',
      detail: 'Requested through the portal.',
    },
  ],
  notifications: [],
};

const patientWith = (events: PatientAccount['events']): PatientAccount => ({
  ...patientWithEvents,
  events,
});

const appointmentWith = (events: OversightAppointment['events']): OversightAppointment => ({
  ...appointmentWithEvents,
  events,
});

const phiEvent: PhiAccessEvent = {
  id: 'phi-1',
  actor: 'Marcus Reed',
  subjectId: 'PT-1004',
  subjectLabel: 'Queue ticket A-104',
  category: 'billing-dispute',
  reason: 'Ahmed Nabil asked us to check the disputed charge on this ticket.',
  at: daysAgo(1),
  durationMinutes: 15,
};

const contentAccessEntry: ContentAccessEntry = {
  id: 'ca-1',
  conversationId: 'cv-referral',
  category: 'legal-request',
  reason: 'Ahmed Nabil requested this transcript for the complaint file.',
  actor: 'Marcus Reed',
  openedAt: daysAgo(1),
  closedAt: null,
  outcome: null,
};

const legacyAudit: readonly AuditEvent[] = [
  {
    id: 'aud-5',
    actor: 'System',
    action: 'Failed login attempts',
    target: 'admin@medora.health - 3 attempts',
    at: daysAgo(4),
    severity: 'critical',
  },
];

const event = (overrides: Partial<LogEvent> = {}): LogEvent => ({
  id: 'e1',
  at: daysAgo(1),
  category: 'authentication',
  type: 'login-succeeded',
  severity: 'info',
  actor: 'Dr. Amelia Chen',
  actorRole: 'doctor',
  target: 'LIC-88213',
  action: 'Sign-in succeeded',
  summary: 'Sign-in succeeded from Berlin',
  ip: '10.0.0.1',
  device: 'Chrome',
  payload: {},
  ...overrides,
});

/** Every string a log row or its drawer puts in front of a reader. */
const renderedStrings = (events: readonly LogEvent[]): string[] =>
  events.flatMap((event) => [
    event.actor,
    event.action,
    event.target,
    event.summary,
    ...Object.values(event.payload).map((value) => String(value)),
  ]);

describe('classification', () => {
  it('maps a failed doctor sign-in to authentication, carrying its IP', () => {
    const [event] = fromDoctorLogins(doctorWithLogins);

    expect(event?.category).toBe('authentication');
    expect(event?.type).toBe('login-failed');
    expect(event?.ip).toBe('10.0.0.1');
    expect(event?.device).toBe('Chrome');
  });

  it('raises impossible travel to security and critical, not authentication', () => {
    // A geographically impossible sign-in is not a sign-in record; it is the
    // finding about one, and §3.7 files those under Security.
    const events = fromDoctorLogins(doctorWithImpossibleTravel);
    const flagged = events.find((e) => e.type === 'impossible-travel');

    expect(flagged?.category).toBe('security');
    expect(flagged?.severity).toBe('critical');
  });

  it('keeps the sign-in alongside the finding rather than relabelling it', () => {
    // Emitting one event instead of two would drop the successful sign-in
    // from the Authentication filter, which is where an investigator looks
    // first for "did this account get in".
    const events = fromDoctorLogins(doctorWithImpossibleTravel);

    expect(events.map((e) => e.type)).toEqual(['login-succeeded', 'impossible-travel']);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });

  it('gives appointment transitions no IP rather than inventing one', () => {
    const [event] = fromAppointmentEvents(appointmentWithEvents);

    expect(event?.ip).toBeNull();
    expect(event?.device).toBeNull();
  });

  it('classifies a PHI reveal as security and keeps the record label, not a name', () => {
    const [event] = fromPhiAccess([phiEvent]);

    expect(event?.type).toBe('phi-revealed');
    expect(event?.category).toBe('security');
    expect(event?.target).toBe('Queue ticket A-104');
    expect(event?.summary).not.toContain('Ahmed');
  });

  it('classifies a gated content read as security, keeping the entry id and never its reason', () => {
    const [event] = fromContentAccess([contentAccessEntry]);

    expect(event?.type).toBe('communication-content-accessed');
    expect(event?.category).toBe('security');
    // Same id, not a namespaced one — unlike `fromPhiAccess`'s `phi:` prefix.
    // The viewer banner's "ref #" has to find this exact row.
    expect(event?.id).toBe(contentAccessEntry.id);
    expect(event?.target).toBe(contentAccessEntry.conversationId);
    // `reason` is administrator free text and the one field on this source
    // that can carry a patient's name — see `fromPhiAccess`'s own rule.
    expect(event?.summary).not.toContain('Ahmed');
    expect(Object.values(event?.payload ?? {})).not.toContain(contentAccessEntry.reason);
  });

  it('attributes a system-caused patient event to System, an admin-caused one to the admin', () => {
    // `AccountEvent.actor` is optional: a lockout after failed sign-ins has
    // nobody behind it, and blank attribution would read as missing data.
    const events = fromPatientEvents(patientWithEvents);
    const locked = events.find((e) => e.type === 'account-locked');
    const unlocked = events.find((e) => e.type === 'account-unlocked');

    expect(locked?.actor).toBe('System');
    expect(locked?.actorRole).toBe('system');
    expect(unlocked?.actor).toBe('Marcus Reed');
    expect(unlocked?.actorRole).toBe('administrator');
  });

  it('references patients and appointments by record, never by name', () => {
    // Both `target` and `summary` are rendered verbatim, with none of the
    // masking the patients grid applies. Payload too: the drawer prints it.
    const corpus = [
      ...fromPatientEvents(patientWithEvents),
      ...fromAppointmentEvents(appointmentWithEvents),
      ...fromPhiAccess([phiEvent]),
      ...fromContentAccess([contentAccessEntry]),
      ...fromDoctorAudit(BASE_DOCTOR),
      ...fromDoctorLogins(doctorWithLogins),
      ...fromLegacyAudit(legacyAudit),
    ];

    expect(corpus.length).toBeGreaterThan(0);
    for (const text of renderedStrings(corpus)) {
      for (const name of FORBIDDEN_NAMES) {
        expect(text).not.toContain(name);
      }
    }

    // And the references that should be there, are — otherwise a classifier
    // that emitted empty strings would pass the check above.
    const patientTargets = fromPatientEvents(patientWithEvents).map((e) => e.target);
    expect(new Set(patientTargets)).toEqual(new Set(['MRN-4471']));
    expect(fromAppointmentEvents(appointmentWithEvents)[0]?.target).toBe('APT-2418');
  });

  it('preserves the source wording and severity of a legacy audit event', () => {
    // Task 5 projects `action` straight back onto `AuditEvent.action`, and
    // ADM-01's feed test asserts the exact string of a seeded row.
    const [event] = fromLegacyAudit(legacyAudit);

    expect(event?.action).toBe('Failed login attempts');
    expect(event?.severity).toBe('critical');
    expect(event?.type).toBe('failed-attempt-burst');
    expect(event?.actorRole).toBe('system');
  });

  it('preserves the source wording of a doctor audit entry', () => {
    const [event] = fromDoctorAudit(BASE_DOCTOR);

    expect(event?.action).toBe('Account suspended');
    expect(event?.type).toBe('doctor-suspended');
    expect(event?.severity).toBe('warning');
    expect(event?.target).toBe('LIC-88213');
  });

  it('never reaches the `other` fallback for any action string the app writes', () => {
    // AdminAuditEntry.action and AuditEvent.action are plain strings, so the
    // classifier cannot be total by construction. This is the guard: a new
    // call site with a new string fails here rather than silently landing in
    // "other" and disappearing from the event-type filter.
    const written = [
      'Application received',
      'Verification completed',
      'Account suspended',
      'Account reactivated',
      'Document approved',
      'Document rejected',
      'Documents requested',
      'Application rejected',
      'Returned to review',
      'Access reset sent',
      'Administrative fields changed',
      'Updated security policy',
      'Automatic backup completed',
      'Deactivated user',
      'Exported patient summary',
      'Failed login attempts',
      // Written by `administration.api`'s PHI fold-in (`asAuditEvent`).
      'Revealed patient identifiers',
    ];

    for (const action of written) {
      expect(classifyAuditAction(action)).not.toBe('other');
    }
  });

  it('sets the exact action string `PhiAccessProvider.test.tsx` finds the reveal row by', () => {
    // `administration.api.ts:812` (`asAuditEvent`) already writes justified
    // PHI reveals with `action: 'Revealed patient identifiers'`, and
    // `PhiAccessProvider.test.tsx` locates the row with
    // `events.find((event) => event.action === 'Revealed patient identifiers')`.
    // `fromPhiAccess` must produce that exact string — not
    // `EVENT_TYPE_LABEL['phi-revealed']` ('Identifier revealed') — or the
    // summary-feed projection (which maps `LogEvent.action` straight onto
    // `AuditEvent.action`) renames a row that test already asserts on.
    const [event] = fromPhiAccess([phiEvent]);

    expect(event?.action).toBe('Revealed patient identifiers');
  });
});

/**
 * Source-kind → `LogEventType` mappings (`LOGIN_TYPE`, `ACCOUNT_EVENT_TYPE`,
 * `OVERSIGHT_EVENT_TYPE`).
 *
 * `Record<K, LogEventType>` guarantees every key of `K` is *present* — it
 * says nothing about whether a key maps to the *right* value. Swapping
 * `'no-show': 'appointment-no-show'` for `'no-show': 'appointment-completed'`
 * is still a total, single-valued map and would pass every test above it;
 * in an investigation log, that swap is a falsified record. These tests pin
 * the actual `LogEventType` each source kind produces, through the public
 * classifiers (`fromDoctorLogins`, `fromPatientEvents`,
 * `fromAppointmentEvents`) so they exercise the path the app actually uses.
 */
describe('source-kind → LogEventType mappings', () => {
  it('pins every LoginEvent result to its own event type', () => {
    const cases: ReadonlyArray<[LoginEvent['result'], LogEventType]> = [
      ['success', 'login-succeeded'],
      ['failed', 'login-failed'],
      ['blocked', 'login-blocked'],
    ];

    for (const [result, expected] of cases) {
      const doctor = doctorWith([login({ result, impossibleTravel: false })]);
      const [event] = fromDoctorLogins(doctor);
      expect(event?.type).toBe(expected);
    }
  });

  it('pins the AccountEventKind pairs whose meaning would invert if swapped', () => {
    const cases: ReadonlyArray<[AccountEventKind, LogEventType]> = [
      ['sign-in', 'login-succeeded'],
      ['sign-in-failed', 'login-failed'],
      ['account-locked', 'account-locked'],
      ['account-unlocked', 'account-unlocked'],
      ['account-deactivated', 'account-deactivated'],
      ['account-reactivated', 'account-reactivated'],
      ['access-granted', 'access-granted'],
      ['access-revoked', 'access-revoked'],
    ];

    for (const [kind, expected] of cases) {
      const patient = patientWith([{ id: 'e', at: daysAgo(1), kind, detail: 'detail' }]);
      const [event] = fromPatientEvents(patient);
      expect(event?.type).toBe(expected);
    }
  });

  it('pins every OversightEventKind, including that both cancellation kinds share appointment-cancelled', () => {
    const cases: ReadonlyArray<[OversightEventKind, LogEventType]> = [
      ['requested', 'appointment-requested'],
      ['confirmed', 'appointment-confirmed'],
      ['cancelled', 'appointment-cancelled'],
      // Deliberate, not an oversight: an administrative cancellation is still
      // "what happened to the appointment is it was cancelled" — `actorRole`
      // already distinguishes who did it. See the comment on
      // `OVERSIGHT_EVENT_TYPE` in logs.ts.
      ['cancelled-administratively', 'appointment-cancelled'],
      ['completed', 'appointment-completed'],
      ['no-show', 'appointment-no-show'],
    ];

    for (const [kind, expected] of cases) {
      const appointment = appointmentWith([
        { id: 'oe', kind, at: daysAgo(1), actor: 'Dr. Amelia Chen', actorRole: 'doctor', detail: 'detail' },
      ]);
      const [ev] = fromAppointmentEvents(appointment);
      expect(ev?.type).toBe(expected);
    }
  });
});

describe('filtering', () => {
  const withIp = event({ id: 'a', ip: '10.0.0.1' });
  const withoutIp = event({ id: 'b', ip: null });

  it('excludes rows that carry no IP when filtering by IP', () => {
    // An investigator filtering by IP is asking which events came from that
    // address. A row that cannot answer is not an answer, so it is excluded
    // rather than silently matching.
    const kept = filterEvents([withIp, withoutIp], { ...EMPTY_FILTERS, ip: '10.0.0.1' }, 'newest');

    expect(kept.map((e) => e.id)).toEqual(['a']);
  });

  it('keeps both when no IP filter is set', () => {
    const kept = filterEvents([withIp, withoutIp], EMPTY_FILTERS, 'newest');

    expect(kept).toHaveLength(2);
  });

  it('searches actor, event-type label and summary but never a patient name', () => {
    const target = event({ id: 'c', summary: 'Identifier revealed for Queue ticket A-104' });

    expect(filterEvents([target], { ...EMPTY_FILTERS, query: 'queue ticket' }, 'newest')).toHaveLength(1);
    expect(filterEvents([target], { ...EMPTY_FILTERS, query: 'nothing' }, 'newest')).toHaveLength(0);
  });

  it('honours both ends of the date range', () => {
    // Events fall into three zones: before from (excluded), within range (included),
    // and after to (excluded). The test exercises rejection on both sides.
    const beforeFrom = event({ id: 'beforeFrom', at: daysAgo(15) });
    const withinRange = event({ id: 'withinRange', at: daysAgo(4) });
    const afterTo = event({ id: 'afterTo', at: daysAgo(1) });
    const from = new Date(NOW - 7 * DAY_MS).toISOString();
    const to = new Date(NOW - 2 * DAY_MS).toISOString();

    const kept = filterEvents([beforeFrom, withinRange, afterTo], { ...EMPTY_FILTERS, from, to }, 'newest');

    expect(kept.map((e) => e.id)).toEqual(['withinRange']);
  });

  it('includes a row timestamped exactly on the `from` boundary', () => {
    // A boundary is a closed edge, not an open one: an event at exactly
    // `from` is inside the range the investigator asked for.
    const from = new Date(NOW - 7 * DAY_MS).toISOString();
    const onBoundary = event({ id: 'boundary', at: from });

    const kept = filterEvents([onBoundary], { ...EMPTY_FILTERS, from }, 'newest');

    expect(kept.map((e) => e.id)).toEqual(['boundary']);
  });

  it('includes a row timestamped exactly on the `to` boundary', () => {
    // A boundary is a closed edge, not an open one: an event at exactly
    // `to` is inside the range the investigator asked for, matching the
    // inclusive behaviour of the `from` boundary.
    const to = new Date(NOW - 7 * DAY_MS).toISOString();
    const onBoundary = event({ id: 'boundary', at: to });

    const kept = filterEvents([onBoundary], { ...EMPTY_FILTERS, to }, 'newest');

    expect(kept.map((e) => e.id)).toEqual(['boundary']);
  });

  it('sorts newest or oldest first and nothing else', () => {
    const a = event({ id: 'a', at: daysAgo(1) });
    const b = event({ id: 'b', at: daysAgo(5) });

    expect(filterEvents([b, a], EMPTY_FILTERS, 'newest').map((e) => e.id)).toEqual(['a', 'b']);
    expect(filterEvents([b, a], EMPTY_FILTERS, 'oldest').map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('pivot', () => {
  it('produces a filter that selects the row pivoted from', () => {
    const row = event({ id: 'x', ip: '10.0.0.9' });
    const pivoted = pivotOn(EMPTY_FILTERS, 'ip', '10.0.0.9');

    expect(filterEvents([row], pivoted, 'newest').map((e) => e.id)).toEqual(['x']);
  });

  it('replaces rather than accumulates on the same field', () => {
    const once = pivotOn(EMPTY_FILTERS, 'ip', '10.0.0.1');
    const twice = pivotOn(once, 'ip', '10.0.0.2');

    expect(twice.ip).toBe('10.0.0.2');
  });
});

describe('the summary-feed projection', () => {
  it('keeps every event the admin feed shows today', () => {
    // Selecting by category was the first design and it dropped two of these:
    // the backup is a job result (system) and the doctor's export is a user
    // action. Both are rows ADM-01's feed and ADM-09's panel render today.
    const legacy = [
      event({ id: 'aud-1', type: 'settings-changed' }),
      event({ id: 'aud-2', type: 'job-completed' }),
      event({ id: 'aud-3', type: 'account-deactivated' }),
      event({ id: 'aud-4', type: 'data-export' }),
      event({ id: 'aud-5', type: 'failed-attempt-burst' }),
    ];

    const projected = projectAuditFeed(legacy);

    expect(projected.map((e) => e.id)).toEqual(['aud-1', 'aud-2', 'aud-3', 'aud-4', 'aud-5']);
  });

  it('keeps sign-ins and routine appointment transitions out', () => {
    // These are the high-volume sources. A six-row "recent admin activity"
    // widget filled with sign-ins is not a summary of anything.
    const noisy = [
      event({ id: 'l', type: 'login-succeeded' }),
      event({ id: 't', type: 'appointment-confirmed' }),
    ];

    expect(projectAuditFeed(noisy)).toEqual([]);
  });

  it('preserves actor, target, timestamp and severity', () => {
    const source = event({
      id: 'x',
      type: 'doctor-suspended',
      actor: 'Marcus Reed',
      target: 'LIC-1',
      severity: 'warning',
    });

    const [projected] = projectAuditFeed([source]);

    expect(projected).toMatchObject({
      actor: 'Marcus Reed',
      target: 'LIC-1',
      severity: 'warning',
    });
  });

  it('carries the source wording rather than the type label', () => {
    // `EVENT_TYPE_LABEL['settings-changed']` is 'Settings changed'. Projecting
    // that instead of the source's own `action` would rename the seeded
    // 'Updated security policy' row that ADM-01's feed test asserts by string.
    const [projected] = projectAuditFeed([
      event({ id: 'aud-1', type: 'settings-changed', action: 'Updated security policy' }),
    ]);

    expect(projected?.action).toBe('Updated security policy');
  });

  it('round-trips a legacy audit event back to itself, id included', () => {
    // The point of the projection: one audit store, not two that can disagree.
    // `fromLegacyAudit` namespaces ids for the aggregate log, so `toAuditEvent`
    // has to give them back — `getAuditEvents()` is the feed those ids belong
    // to, and ADM-01's security alerts key off them (`critical-audit:aud-5`).
    const [logEvent] = fromLegacyAudit(legacyAudit);
    const source = legacyAudit[0];

    expect(logEvent?.id).toBe('legacy:aud-5');
    expect(logEvent === undefined ? undefined : toAuditEvent(logEvent)).toEqual(source);
  });

  it('leaves a non-legacy event its own namespaced id', () => {
    // Only the `legacy:` namespace is stripped, and only because it was added
    // on the way in. A PHI reveal reaching the feed as `phi:…` has no earlier
    // identity to return to.
    const [logEvent] = fromPhiAccess([phiEvent]);

    expect(logEvent === undefined ? undefined : toAuditEvent(logEvent).id).toBe('phi:phi-1');
  });
});

/* ── One clock ────────────────────────────────────────────────── */

/**
 * The bug this suite exists for: the timestamp column rendered UTC while the
 * From/To fields are `datetime-local` inputs, which speak local wall clock and
 * are parsed as such by `withinRange`. An investigator who read an instant off
 * a row and typed it into a bound got a window shifted by their whole UTC
 * offset, with nothing on screen saying so — three hours of events silently
 * outside an investigation.
 *
 * The zones are the point. On a UTC runner the two clocks agree by accident
 * and every assertion below passes against the broken formatter, so the
 * round trip is run in three offsets — one ahead, one behind, one on the
 * half hour — by moving `process.env.TZ`, which Node applies to `Date` from
 * the next call onwards.
 */
describe('the timestamp column and the date filters', () => {
  const ORIGINAL_TZ = process.env.TZ;
  const ZONES = ['UTC', 'Asia/Riyadh', 'America/Chicago', 'Asia/Kolkata'] as const;

  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  /** The prefix a reader copies out of the column, in the input's own shape. */
  const asTyped = (shown: string): string => shown.slice(0, 16).replace(' ', 'T');

  for (const zone of ZONES) {
    it(`accepts a bound typed off a row it is meant to keep, in ${zone}`, () => {
      process.env.TZ = zone;
      const at = '2026-08-10T03:05:22.481Z';
      const row = event({ id: 'x', at });

      // Exactly what an investigator does: read the row's instant, type its
      // minute into From, and the minute after into To.
      const from = asTyped(formatTimestamp(at));
      // Also read off the column, not built with `toDateTimeLocalValue`: the
      // claim is that *this column* and the filters share a clock, so both
      // bounds have to come from the same place a reader gets them.
      const to = asTyped(formatTimestamp(new Date(Date.parse(at) + 60_000).toISOString()));

      expect(filterEvents([row], { ...EMPTY_FILTERS, from }, 'newest').map((e) => e.id)).toEqual([
        'x',
      ]);
      expect(
        filterEvents([row], { ...EMPTY_FILTERS, from, to }, 'newest').map((e) => e.id),
      ).toEqual(['x']);
    });
  }

  it('writes a filter value in the same wall clock the column prints', () => {
    // The structural half of the claim above: whatever zone the reader is in,
    // the column's first sixteen characters *are* the value the filter parses.
    // Stated separately because the round trip could also be satisfied by two
    // formatters that happen to agree at one instant.
    process.env.TZ = 'Asia/Kolkata';
    const at = '2026-08-10T03:05:22.481Z';

    expect(formatTimestamp(at)).toBe('2026-08-10 08:35:22.481');
    expect(toDateTimeLocalValue(new Date(at))).toBe('2026-08-10T08:35');
  });

  it('reads the same instant differently either side of the meridian', () => {
    // A positive control for the two tests above: if `process.env.TZ` were
    // not reaching `Date`, every zone would produce identical output and the
    // round trip would prove nothing.
    process.env.TZ = 'Asia/Riyadh';
    const ahead = formatTimestamp('2026-08-10T03:05:22.481Z');
    process.env.TZ = 'America/Chicago';
    const behind = formatTimestamp('2026-08-10T03:05:22.481Z');

    expect(ahead).toBe('2026-08-10 06:05:22.481');
    expect(behind).toBe('2026-08-09 22:05:22.481');
  });

  it('still says — for an instant it cannot read', () => {
    expect(formatTimestamp('not a date')).toBe('—');
  });
});
