/**
 * Patients management — mock service and store (ADM-04 · UX §3.4).
 *
 * Stands in for the platform's patient-account API. The rules it enforces
 * are the ones an administrator can otherwise talk themselves past:
 *
 * - **No operation on this service accepts a password.** `resetCredentials`
 *   sends the patient a link and records that it was sent. There is no
 *   parameter to set one, which is the point: §3.4 says an administrator
 *   never chooses a patient's credentials, and a service that *could* would
 *   make that a policy rather than a guarantee.
 * - **Revoking access requires a written reason**, re-validated here rather
 *   than trusted from the dialog, and revocation keeps the row so the grid
 *   remains a complete history.
 * - Every write appends an attributed account event. There is no way to
 *   change an account's standing without leaving a name and a timestamp.
 *
 * Mutations resolve to the full patched document so the query layer seeds
 * its cache instead of refetching.
 */

import {
  DATA_ERROR_FIELD_LABEL,
  openReportsForPatient,
} from '@/features/shared-domain/data-error-reports';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { validateReason } from '../patients';
import type {
  AccessGrant,
  AccessRequest,
  AccessScope,
  AccountEvent,
  AccountEventKind,
  GranteeRole,
  LockCause,
  PatientAccount,
  PatientAccountStatus,
  SupportFlag,
} from '../patients.types';

const LATENCY_MS = 260;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

/* ── Seed ─────────────────────────────────────────────────────── */

/**
 * Seeded from the canonical five-patient roster in `shared-domain`, so the
 * admin area and the doctor area name the same people. Only the account
 * layer is added here — the roster owns identity, this owns standing.
 */
interface GrantSeed {
  readonly grantee: string;
  readonly role: GranteeRole;
  readonly scope: AccessScope;
  readonly grantedDaysAgo: number;
  readonly grantedBy: string;
  /** Set to record a grant that has since been revoked (history, §3.4). */
  readonly revoked?: { readonly daysAgo: number; readonly by: string; readonly reason: string };
}

interface RequestSeed {
  readonly requester: string;
  readonly role: GranteeRole;
  readonly scope: AccessScope;
  readonly hoursAgo: number;
  readonly reason: string;
}

interface AccountSeed {
  readonly id: string;
  readonly status: PatientAccountStatus;
  readonly lockCause?: LockCause;
  readonly deactivationReason?: string;
  readonly lastActivityDaysAgo: number;
  readonly grants: readonly GrantSeed[];
  readonly requests: readonly RequestSeed[];
  readonly flags: readonly Omit<SupportFlag, 'id'>[];
  /** Patient-driven history, newest first, as `[kind, daysAgo, detail, count?]`. */
  readonly history: readonly (readonly [AccountEventKind, number, string, number?])[];
}

const SEEDS: readonly AccountSeed[] = [
  {
    id: 'PT-1001',
    status: 'active',
    lastActivityDaysAgo: 0,
    grants: [
      {
        grantee: 'Dr. Amelia Chen',
        role: 'doctor',
        scope: 'full-record',
        grantedDaysAgo: 730,
        grantedBy: 'Registration',
      },
      {
        grantee: 'Nurse Hana Said',
        role: 'nurse',
        scope: 'summary',
        grantedDaysAgo: 400,
        grantedBy: 'Marcus Reed',
      },
    ],
    requests: [],
    flags: [],
    history: [
      ['sign-in', 0, 'Patient portal, mobile'],
      ['booking-made', 1, 'Follow-up with Dr. Amelia Chen'],
      ['messages-sent', 7, 'To the care team', 4],
      ['consent-change', 120, 'Opted in to appointment reminders'],
    ],
  },
  {
    /* The support case: locked out, and asking for help. */
    id: 'PT-1002',
    status: 'locked',
    lockCause: 'failed-sign-ins',
    lastActivityDaysAgo: 1,
    grants: [
      {
        grantee: 'Dr. Amelia Chen',
        role: 'doctor',
        scope: 'full-record',
        grantedDaysAgo: 9,
        grantedBy: 'Registration',
      },
    ],
    requests: [
      {
        requester: 'Dr. Salma Ibrahim',
        role: 'doctor',
        scope: 'summary',
        hoursAgo: 20,
        reason: 'Covering the asthma clinic on Thursday; need the summary before the visit.',
      },
    ],
    flags: [
      {
        kind: 'access',
        summary: 'Cannot sign in — reports the reset email never arrives.',
        openedAt: hoursAgo(30),
      },
    ],
    history: [
      ['account-locked', 1, 'Five consecutive failed sign-ins'],
      ['sign-in-failed', 1, 'Patient portal, web'],
      ['sign-in', 3, 'Patient portal, web'],
      ['booking-made', 9, 'First appointment with Dr. Amelia Chen'],
    ],
  },
  {
    /* Carries a revoked grant, so the grid has a history to show. */
    id: 'PT-1003',
    status: 'active',
    lastActivityDaysAgo: 45,
    grants: [
      {
        grantee: 'Dr. Amelia Chen',
        role: 'doctor',
        scope: 'summary',
        grantedDaysAgo: 365,
        grantedBy: 'Registration',
      },
      {
        grantee: 'Medora Laboratory',
        role: 'laboratory',
        scope: 'labs',
        grantedDaysAgo: 200,
        grantedBy: 'Marcus Reed',
      },
      {
        grantee: 'Dr. Youssef Nabil',
        role: 'doctor',
        scope: 'full-record',
        grantedDaysAgo: 180,
        grantedBy: 'Marcus Reed',
        revoked: {
          daysAgo: 30,
          by: 'Marcus Reed',
          reason: 'Locum cover ended; access no longer clinically required.',
        },
      },
    ],
    requests: [],
    flags: [
      {
        kind: 'data-correction',
        summary: 'Date of birth disputed — patient says the year is wrong.',
        openedAt: daysAgo(6),
      },
    ],
    history: [
      ['sign-in', 45, 'Patient portal, web'],
      ['access-revoked', 30, 'Dr. Youssef Nabil — full record'],
      ['booking-cancelled', 50, 'Cancelled by patient'],
    ],
  },
  {
    /* The busiest record: several holders and a request waiting. */
    id: 'PT-1004',
    status: 'active',
    lastActivityDaysAgo: 2,
    grants: [
      {
        grantee: 'Dr. Amelia Chen',
        role: 'doctor',
        scope: 'full-record',
        grantedDaysAgo: 1095,
        grantedBy: 'Registration',
      },
      {
        grantee: 'Dr. Omar Khalil',
        role: 'doctor',
        scope: 'labs',
        grantedDaysAgo: 240,
        grantedBy: 'Marcus Reed',
      },
      {
        grantee: 'Medora Laboratory',
        role: 'laboratory',
        scope: 'labs',
        grantedDaysAgo: 240,
        grantedBy: 'Marcus Reed',
      },
    ],
    requests: [
      {
        requester: 'Medora Pharmacy',
        role: 'pharmacy',
        scope: 'prescriptions',
        hoursAgo: 5,
        reason: 'Dispensing review for the renal dose adjustment flagged this morning.',
      },
    ],
    flags: [],
    history: [
      ['sign-in', 2, 'Patient portal, mobile'],
      ['booking-made', 2, 'Urgent review with Dr. Amelia Chen'],
      ['messages-sent', 4, 'To the care team', 9],
      ['consent-change', 300, 'Consented to research contact'],
    ],
  },
  {
    /* Deactivated and dormant — the account nobody can reach. */
    id: 'PT-1005',
    status: 'inactive',
    deactivationReason: 'Patient requested account closure after moving abroad.',
    lastActivityDaysAgo: 120,
    grants: [
      {
        grantee: 'Dr. Omar Khalil',
        role: 'doctor',
        scope: 'full-record',
        grantedDaysAgo: 540,
        grantedBy: 'Registration',
        revoked: {
          daysAgo: 110,
          by: 'Marcus Reed',
          reason: 'Account closed at the patient’s request; access withdrawn.',
        },
      },
    ],
    requests: [],
    flags: [],
    history: [
      ['account-deactivated', 110, 'Closure requested by the patient'],
      ['sign-in', 120, 'Patient portal, web'],
    ],
  },
];

let sequence = 0;

function writeId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(Date.now())}-${String(sequence)}`;
}

/** Stable ids at seed time so a reload does not renumber the fixtures. */
function seedId(prefix: string, patientId: string, index: number): string {
  return `${prefix}-${patientId}-${String(index)}`;
}

function expandGrant(seed: GrantSeed, patientId: string, index: number): AccessGrant {
  return {
    id: seedId('grant', patientId, index),
    granteeId: seed.grantee.toLowerCase().replace(/[^a-z]+/g, '-'),
    granteeName: seed.grantee,
    granteeRole: seed.role,
    scope: seed.scope,
    grantedBy: seed.grantedBy,
    grantedAt: daysAgo(seed.grantedDaysAgo),
    status: seed.revoked ? 'revoked' : 'active',
    revokedBy: seed.revoked?.by ?? null,
    revokedAt: seed.revoked ? daysAgo(seed.revoked.daysAgo) : null,
    revocationReason: seed.revoked?.reason ?? null,
  };
}

function expandRequest(seed: RequestSeed, patientId: string, index: number): AccessRequest {
  return {
    id: seedId('req', patientId, index),
    requesterId: seed.requester.toLowerCase().replace(/[^a-z]+/g, '-'),
    requesterName: seed.requester,
    requesterRole: seed.role,
    scope: seed.scope,
    requestedAt: hoursAgo(seed.hoursAgo),
    reason: seed.reason,
  };
}

/**
 * Derives a support address from the roster name. The roster carries no
 * email — it is a clinical fixture — and `example.test` is reserved, so no
 * fixture can ever reach a real inbox.
 */
function supportEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.test`;
}

function expand(seed: AccountSeed): PatientAccount {
  const roster = MOCK_PATIENTS.find((patient) => patient.id === seed.id);
  if (roster === undefined) {
    throw new Error(`Patient ${seed.id} is not on the shared roster.`);
  }

  const events: AccountEvent[] = seed.history.map(([kind, days, detail, count], index) => ({
    id: seedId('evt', seed.id, index),
    at: daysAgo(days),
    kind,
    detail,
    ...(count === undefined ? {} : { count }),
    ...(isSeededAdminEvent(kind) ? { actor: 'Marcus Reed' } : {}),
  }));

  return {
    id: roster.id,
    name: roster.name,
    mrn: roster.mrn,
    email: supportEmail(roster.name),
    phone: roster.phone,
    dateOfBirth: roster.dateOfBirth,
    status: seed.status,
    lockCause: seed.lockCause ?? null,
    registeredAt: roster.registeredAt,
    lastActivityAt: daysAgo(seed.lastActivityDaysAgo),
    assignedDoctors: seed.grants
      .filter((grant) => grant.role === 'doctor' && !grant.revoked)
      .map((grant) => grant.grantee),
    deactivationReason: seed.deactivationReason ?? null,
    grants: seed.grants.map((grant, index) => expandGrant(grant, seed.id, index)),
    accessRequests: seed.requests.map((request, index) => expandRequest(request, seed.id, index)),
    events,
    flags: seed.flags.map((flag, index) => ({ ...flag, id: seedId('flag', seed.id, index) })),
  };
}

/**
 * Data errors a doctor flagged on the patient record (D-07), as this
 * account's support flags.
 *
 * They arrive as `data-correction`, which `SupportFlagKind` has always had
 * and nothing produced — so a doctor's report reaches `openWorkCount`, and
 * through it the ADM-01 action queue's "Accounts with open issues" row and
 * its `/admin/patients?flag=open` destination, with no new screen and no
 * second count that could disagree with the one already there.
 *
 * The reports are read from `shared-domain`, not from the doctor feature:
 * §3.4 forbids this module importing `features/doctor/*`, and the store is
 * the sanctioned meeting point (the same arrangement D-14 uses for lab
 * attachments). Only OPEN reports become flags — a resolved one is history,
 * and leaving it in the count would keep an administrator's queue red for
 * work they have already done.
 */
function doctorReportedFlags(patientId: string): readonly SupportFlag[] {
  return openReportsForPatient(patientId).map((report) => ({
    id: report.id,
    kind: 'data-correction' as const,
    // The doctor's own words, prefixed with the field they named. An
    // administrator acting on this needs to know what to correct before
    // they read the prose.
    summary: `${DATA_ERROR_FIELD_LABEL[report.field]} — ${report.description} (reported by ${report.reportedBy})`,
    openedAt: report.reportedAt,
  }));
}

function isSeededAdminEvent(kind: AccountEventKind): boolean {
  return kind === 'access-revoked' || kind === 'account-deactivated' || kind === 'account-locked';
}

/* ── Store ────────────────────────────────────────────────────── */

const STORAGE_KEY = 'medora.admin.patients.v1';

export interface PatientsDocument {
  readonly patients: readonly PatientAccount[];
}

export const DEFAULT_PATIENTS: PatientsDocument = { patients: SEEDS.map(expand) };

/**
 * Folds the doctors' open data-error reports onto their accounts (D-07).
 *
 * **At read time, never into the stored document.** `DEFAULT_PATIENTS` is
 * built once at module load, so a report filed afterwards would never appear
 * if this were done in `expand`; and persisting a merged document would bake
 * the reports into `localStorage`, where resolving one could not remove it
 * and the next merge would duplicate it. So `load` merges on the way out and
 * `persist` stores what it was given — the administrator's own decisions —
 * leaving the reports owned by the one store that can resolve them.
 */
function withDoctorReports(document: PatientsDocument): PatientsDocument {
  return {
    ...document,
    patients: document.patients.map((patient) => {
      const reported = doctorReportedFlags(patient.id);
      if (reported.length === 0) return patient;
      // Filter first: a document that has been through here before (a
      // mutation's return value, re-read) must not accumulate copies.
      const own = patient.flags.filter((flag) => !flag.id.startsWith('DER-'));
      return { ...patient, flags: [...own, ...reported] };
    }),
  };
}

function load(): PatientsDocument {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return withDoctorReports(DEFAULT_PATIENTS);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return withDoctorReports(DEFAULT_PATIENTS);
    }
    return withDoctorReports({ ...DEFAULT_PATIENTS, ...(parsed as Partial<PatientsDocument>) });
  } catch {
    return withDoctorReports(DEFAULT_PATIENTS);
  }
}

function persist(document: PatientsDocument): PatientsDocument {
  try {
    // Stored WITHOUT the doctors' reports: those belong to their own store,
    // which is the only thing that can resolve them. See `withDoctorReports`.
    const stored: PatientsDocument = {
      ...document,
      patients: document.patients.map((patient) => ({
        ...patient,
        flags: patient.flags.filter((flag) => !flag.id.startsWith('DER-')),
      })),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable — decisions stay session-local.
  }
  // Returned WITH them, because callers seed this straight into the query
  // cache; stripping them here would blank the queue after any admin action.
  return withDoctorReports(document);
}

export class PatientsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatientsError';
  }
}

function requirePatient(document: PatientsDocument, id: string): PatientAccount {
  const patient = document.patients.find((entry) => entry.id === id);
  if (patient === undefined) {
    throw new PatientsError('That account no longer exists. Refresh and try again.');
  }
  return patient;
}

/** Prepends one event; the timeline is newest-first everywhere it is read. */
function logged(
  patient: PatientAccount,
  kind: AccountEventKind,
  detail: string,
  actor: string,
): readonly AccountEvent[] {
  return [
    { id: writeId('evt'), at: new Date().toISOString(), kind, detail, actor },
    ...patient.events,
  ];
}

function patch(
  document: PatientsDocument,
  id: string,
  changes: (patient: PatientAccount) => PatientAccount,
): PatientsDocument {
  return {
    ...document,
    patients: document.patients.map((entry) => (entry.id === id ? changes(entry) : entry)),
  };
}

/** Keeps the denormalised list column in step with the grid it summarises. */
function withDerivedDoctors(patient: PatientAccount): PatientAccount {
  return {
    ...patient,
    assignedDoctors: [
      ...new Set(
        patient.grants
          .filter((grant) => grant.status === 'active' && grant.granteeRole === 'doctor')
          .map((grant) => grant.granteeName),
      ),
    ].sort(),
  };
}

function checkedReason(reason: string): string {
  const check = validateReason(reason);
  if (!check.ok) throw new PatientsError(check.message ?? 'A written reason is required.');
  return reason.trim();
}

export interface AccountInput {
  readonly patientId: string;
  readonly actor: string;
}

export interface ReasonedAccountInput extends AccountInput {
  readonly reason: string;
}

export interface RevokeInput extends ReasonedAccountInput {
  readonly grantId: string;
}

export interface RequestDecisionInput extends AccountInput {
  readonly requestId: string;
}

export interface DenyRequestInput extends RequestDecisionInput {
  readonly reason: string;
}

export const patientsApi = {
  list: (): Promise<PatientsDocument> => delay(load()),

  /** Clears a lock. Refuses on an account that is not locked. */
  unlock: async ({ patientId, actor }: AccountInput): Promise<PatientsDocument> => {
    const document = load();
    const patient = requirePatient(document, patientId);
    if (patient.status !== 'locked') {
      throw new PatientsError('That account is not locked.');
    }
    return delay(
      persist(
        patch(document, patientId, (entry) => ({
          ...entry,
          status: 'active' as const,
          lockCause: null,
          events: logged(entry, 'account-unlocked', 'Lock cleared by an administrator', actor),
        })),
      ),
    );
  },

  /**
   * Sends the patient a secure reset link.
   *
   * Note what this signature does NOT take: a password, a temporary
   * credential, or anything else an administrator could choose on the
   * patient's behalf. §3.4 requires that only the patient sets it, and the
   * cheapest way to guarantee that is to give the service no way to.
   */
  resetCredentials: async ({ patientId, actor }: AccountInput): Promise<PatientsDocument> => {
    const document = load();
    const patient = requirePatient(document, patientId);
    if (patient.status === 'inactive') {
      throw new PatientsError(
        'A deactivated account cannot receive a reset link. Reactivate it first.',
      );
    }
    return delay(
      persist(
        patch(document, patientId, (entry) => ({
          ...entry,
          events: logged(
            entry,
            'credential-reset',
            `Secure reset link sent to ${entry.email}`,
            actor,
          ),
        })),
      ),
    );
  },

  deactivate: async ({
    patientId,
    actor,
    reason,
  }: ReasonedAccountInput): Promise<PatientsDocument> => {
    const document = load();
    const patient = requirePatient(document, patientId);
    if (patient.status === 'inactive') {
      throw new PatientsError('That account is already deactivated.');
    }
    const detail = checkedReason(reason);
    return delay(
      persist(
        patch(document, patientId, (entry) => ({
          ...entry,
          status: 'inactive' as const,
          lockCause: null,
          deactivationReason: detail,
          events: logged(entry, 'account-deactivated', detail, actor),
        })),
      ),
    );
  },

  reactivate: async ({ patientId, actor }: AccountInput): Promise<PatientsDocument> => {
    const document = load();
    const patient = requirePatient(document, patientId);
    if (patient.status !== 'inactive') {
      throw new PatientsError('That account is already active.');
    }
    return delay(
      persist(
        patch(document, patientId, (entry) => ({
          ...entry,
          status: 'active' as const,
          deactivationReason: null,
          events: logged(entry, 'account-reactivated', 'Account restored by an administrator', actor),
        })),
      ),
    );
  },

  /**
   * Withdraws one grant. The row stays with its reason attached rather than
   * disappearing — the grid is the access history, not a list of who
   * happens to hold access this afternoon.
   */
  revokeAccess: async ({
    patientId,
    grantId,
    actor,
    reason,
  }: RevokeInput): Promise<PatientsDocument> => {
    const document = load();
    const patient = requirePatient(document, patientId);
    const grant = patient.grants.find((entry) => entry.id === grantId);
    if (grant === undefined) throw new PatientsError('That access grant no longer exists.');
    if (grant.status === 'revoked') {
      throw new PatientsError('That access was already revoked.');
    }
    const detail = checkedReason(reason);
    const at = new Date().toISOString();

    return delay(
      persist(
        patch(document, patientId, (entry) =>
          withDerivedDoctors({
            ...entry,
            grants: entry.grants.map((item) =>
              item.id === grantId
                ? {
                    ...item,
                    status: 'revoked' as const,
                    revokedBy: actor,
                    revokedAt: at,
                    revocationReason: detail,
                  }
                : item,
            ),
            events: logged(
              entry,
              'access-revoked',
              `${grant.granteeName} — ${grant.scope.replace('-', ' ')}: ${detail}`,
              actor,
            ),
          }),
        ),
      ),
    );
  },

  /** Approves a pending request, which becomes a live grant. */
  approveRequest: async ({
    patientId,
    requestId,
    actor,
  }: RequestDecisionInput): Promise<PatientsDocument> => {
    const document = load();
    const patient = requirePatient(document, patientId);
    const request = patient.accessRequests.find((entry) => entry.id === requestId);
    if (request === undefined) throw new PatientsError('That request has already been decided.');

    const grant: AccessGrant = {
      id: writeId('grant'),
      granteeId: request.requesterId,
      granteeName: request.requesterName,
      granteeRole: request.requesterRole,
      scope: request.scope,
      grantedBy: actor,
      grantedAt: new Date().toISOString(),
      status: 'active',
      revokedBy: null,
      revokedAt: null,
      revocationReason: null,
    };

    return delay(
      persist(
        patch(document, patientId, (entry) =>
          withDerivedDoctors({
            ...entry,
            grants: [grant, ...entry.grants],
            accessRequests: entry.accessRequests.filter((item) => item.id !== requestId),
            events: logged(
              entry,
              'access-granted',
              `${request.requesterName} — ${request.scope.replace('-', ' ')}`,
              actor,
            ),
          }),
        ),
      ),
    );
  },

  denyRequest: async ({
    patientId,
    requestId,
    actor,
    reason,
  }: DenyRequestInput): Promise<PatientsDocument> => {
    const document = load();
    const patient = requirePatient(document, patientId);
    const request = patient.accessRequests.find((entry) => entry.id === requestId);
    if (request === undefined) throw new PatientsError('That request has already been decided.');
    const detail = checkedReason(reason);

    return delay(
      persist(
        patch(document, patientId, (entry) => ({
          ...entry,
          accessRequests: entry.accessRequests.filter((item) => item.id !== requestId),
          events: logged(
            entry,
            'access-revoked',
            `Request from ${request.requesterName} declined: ${detail}`,
            actor,
          ),
        })),
      ),
    );
  },
};
