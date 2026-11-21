/**
 * Patients management — the pure half (ADM-04 · UX §3.4).
 *
 * Two rules carry most of this file's weight, and both exist because the
 * screen governs access to medical records:
 *
 *  - **An administrator never sets a credential.** "Reset credentials"
 *    sends the patient a secure link; there is no code path here, or in the
 *    service, that accepts a password. §3.4 says so in as many words, and
 *    the absence is the feature.
 *  - **Revoking access is a decision with a reason**, not a toggle. The
 *    grid's revoke path is validated the same way a suspension is, because
 *    "who took Dr. Khalil off this record, and why" is exactly the question
 *    an audit asks six months later.
 *
 * Everything here is component-free and takes `now` as a parameter, so the
 * time-dependent bands are testable without freezing a clock.
 */

import type { StatusKind } from '@/components/patterns';
import type { BadgeVariant } from '@/components/ui';
import { formatDateWith } from '@/i18n';

import type {
  AccessGrant,
  AccessScope,
  AccountEventKind,
  ActivityKey,
  GranteeRole,
  LockCause,
  PatientAccount,
  PatientAccountStatus,
  PatientFilters,
  RegisteredRangeKey,
  SupportFlagKind,
} from './patients.types';

const DAY_MS = 86_400_000;

/** Free-text floor for a deactivation or revocation reason. */
export const REASON_MIN_LENGTH = 12;

/** An account quiet for longer than this is surfaced as dormant. */
export const DORMANT_DAYS = 90;

/** The upper edge of "recently active". */
export const RECENT_DAYS = 30;

/* ── Account lifecycle ────────────────────────────────────────── */

/** Unlocking only means something on a locked account. */
export function canUnlock(patient: PatientAccount): boolean {
  return patient.status === 'locked';
}

/**
 * Deactivation is available on any live account, locked ones included: a
 * support hold that turns out to be a compromised account should be
 * closable without unlocking it first.
 */
export function canDeactivate(patient: PatientAccount): boolean {
  return patient.status !== 'inactive';
}

export function canReactivate(patient: PatientAccount): boolean {
  return patient.status === 'inactive';
}

/**
 * A deactivated account cannot receive a sign-in link, so offering one
 * would send mail that provably cannot work.
 */
export function canResetCredentials(patient: PatientAccount): boolean {
  return patient.status !== 'inactive';
}

export interface ReasonValidation {
  readonly ok: boolean;
  readonly message?: string;
}

export function validateReason(reason: string): ReasonValidation {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, message: 'A written reason is required.' };
  if (trimmed.length < REASON_MIN_LENGTH) {
    return {
      ok: false,
      message: `Give at least ${String(REASON_MIN_LENGTH)} characters — this is kept on the account record.`,
    };
  }
  return { ok: true };
}

/* ── Access grid ──────────────────────────────────────────────── */

export function activeGrants(patient: PatientAccount): readonly AccessGrant[] {
  return patient.grants.filter((grant) => grant.status === 'active');
}

export function revokedGrants(patient: PatientAccount): readonly AccessGrant[] {
  return patient.grants.filter((grant) => grant.status === 'revoked');
}

/** Only a live grant can be revoked; revoking twice is not a second event. */
export function canRevoke(grant: AccessGrant): boolean {
  return grant.status === 'active';
}

/**
 * The names shown in the list's "assigned doctors" column, derived from
 * live grants rather than stored alongside them. A count that is written
 * down separately is a count that goes stale the first time somebody
 * revokes access; deriving it means the column cannot disagree with the
 * grid it summarises.
 */
export function assignedDoctorNames(patient: PatientAccount): readonly string[] {
  return [
    ...new Set(
      activeGrants(patient)
        .filter((grant) => grant.granteeRole === 'doctor')
        .map((grant) => grant.granteeName),
    ),
  ].sort();
}

/**
 * Whether this record is reachable by anyone at all. An empty grid is the
 * §3.4 empty state, but it is also worth saying plainly on the profile:
 * a record nobody can open is a patient nobody can treat.
 */
export function hasNoActiveAccess(patient: PatientAccount): boolean {
  return activeGrants(patient).length === 0;
}

/* ── Filters, bands and counts ────────────────────────────────── */

export const EMPTY_FILTERS: PatientFilters = {
  query: '',
  status: 'all',
  registered: 'any',
  doctor: 'all',
  activity: 'any',
  openWork: false,
};

export function daysSince(iso: string, now: number): number {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - at) / DAY_MS;
}

/** Which activity band an account falls in, by its last recorded action. */
export function activityBand(patient: PatientAccount, now: number): Exclude<ActivityKey, 'any'> {
  const days = daysSince(patient.lastActivityAt, now);
  if (days <= RECENT_DAYS) return 'recent';
  if (days <= DORMANT_DAYS) return 'quiet';
  return 'dormant';
}

function registeredWithin(iso: string, range: RegisteredRangeKey, now: number): boolean {
  if (range === 'any') return true;
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
  return daysSince(iso, now) <= days;
}

export function matchesFilters(
  patient: PatientAccount,
  filters: PatientFilters,
  now: number,
): boolean {
  if (filters.status !== 'all' && patient.status !== filters.status) return false;
  if (!registeredWithin(patient.registeredAt, filters.registered, now)) return false;
  if (filters.activity !== 'any' && activityBand(patient, now) !== filters.activity) return false;
  if (filters.doctor !== 'all' && !assignedDoctorNames(patient).includes(filters.doctor)) {
    return false;
  }

  const query = filters.query.trim().toLowerCase();
  if (query.length > 0) {
    // Phone digits are compared without formatting so "5550184402" finds
    // "+1 (555) 018-4402" — an administrator reading a number off a ticket
    // has not got the punctuation.
    const digits = query.replace(/\D/g, '');
    const haystack = [patient.name, patient.id, patient.mrn, patient.email, patient.phone]
      .join(' ')
      .toLowerCase();
    const phoneDigits = patient.phone.replace(/\D/g, '');
    const phoneHit = digits.length >= 4 && phoneDigits.includes(digits);
    if (!haystack.includes(query) && !phoneHit) return false;
  }

  // The same `openWorkCount` the column shows and the sort ranks on, so the
  // ADM-01 queue's count and the rows it lands on cannot describe different
  // accounts. Narrowing this to flags alone is the drift ADM-04 already fixed.
  if (filters.openWork && openWorkCount(patient) === 0) return false;
  return true;
}

/**
 * Everything on this account somebody is waiting for a reply to. This is
 * the number the list's "open issues" column shows, and it is deliberately
 * the same one the ordering ranks on — a column that says there is work
 * here while the sort buries the row is a column nobody learns to trust.
 */
export function openWorkCount(patient: PatientAccount): number {
  return patient.flags.length + patient.accessRequests.length;
}

/**
 * Filtered, then ordered so the work leads: locked accounts first (somebody
 * cannot sign in at all), then anything with open work on it, then by name.
 */
export function filterPatients(
  patients: readonly PatientAccount[],
  filters: PatientFilters,
  now: number,
): readonly PatientAccount[] {
  return patients
    .filter((patient) => matchesFilters(patient, filters, now))
    .slice()
    .sort((a, b) => {
      const rank = (patient: PatientAccount) =>
        patient.status === 'locked' ? 0 : openWorkCount(patient) > 0 ? 1 : 2;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
}

export interface PatientSummary {
  readonly total: number;
  readonly locked: number;
  readonly inactive: number;
  readonly openIssues: number;
  readonly pendingRequests: number;
}

/**
 * The headline counts. `openIssues` and `pendingRequests` are the two an
 * administrator can act on, which is why they lead the strip rather than a
 * total that never changes.
 */
export function summarise(patients: readonly PatientAccount[]): PatientSummary {
  return {
    total: patients.length,
    locked: patients.filter((patient) => patient.status === 'locked').length,
    inactive: patients.filter((patient) => patient.status === 'inactive').length,
    openIssues: patients.reduce((sum, patient) => sum + patient.flags.length, 0),
    pendingRequests: patients.reduce((sum, patient) => sum + patient.accessRequests.length, 0),
  };
}

/** Every doctor holding live access to anyone, for the filter's options. */
export function assignedDoctorOptions(patients: readonly PatientAccount[]): readonly string[] {
  return [...new Set(patients.flatMap((patient) => assignedDoctorNames(patient)))].sort();
}

/* ── Labels & badge variants ──────────────────────────────────── */

export const STATUS_LABEL: Record<PatientAccountStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  locked: 'Locked',
};

/*
 * `locked` takes `cancelled` rather than a bare alarm hue: a lock is an
 * imposed stop the administrator can lift, which is what the Ban glyph says,
 * and it stays distinct from `critical` now that emphasis splits the red
 * family into live alarms and terminal outcomes.
 */
export const STATUS_KIND: Record<PatientAccountStatus, StatusKind> = {
  active: 'active',
  inactive: 'archived',
  locked: 'cancelled',
};

export const LOCK_CAUSE_LABEL: Record<LockCause, string> = {
  'failed-sign-ins': 'Too many failed sign-ins',
  'support-hold': 'Support hold',
  'suspected-compromise': 'Suspected compromise',
};

export const SCOPE_LABEL: Record<AccessScope, string> = {
  'full-record': 'Full record',
  summary: 'Summary only',
  labs: 'Lab results',
  prescriptions: 'Prescriptions',
  appointments: 'Appointments',
};

/**
 * Full-record access is the one worth a second look in a list of twelve
 * rows, so it is toned rather than left to read like every other scope.
 */
export const SCOPE_VARIANT: Record<AccessScope, BadgeVariant> = {
  'full-record': 'warning',
  summary: 'neutral',
  labs: 'info',
  prescriptions: 'success',
  appointments: 'neutral',
};

export const GRANTEE_ROLE_LABEL: Record<GranteeRole, string> = {
  doctor: 'Doctor',
  nurse: 'Nurse',
  laboratory: 'Laboratory',
  pharmacy: 'Pharmacy',
};

export const ACTIVITY_LABEL: Record<ActivityKey, string> = {
  any: 'Any activity',
  recent: `Active in ${String(RECENT_DAYS)} days`,
  quiet: 'Quiet 30–90 days',
  dormant: `Dormant ${String(DORMANT_DAYS)}+ days`,
};

export const REGISTERED_RANGE_LABEL: Record<RegisteredRangeKey, string> = {
  any: 'Registered any time',
  '30d': 'Registered in 30 days',
  '90d': 'Registered in 90 days',
  '365d': 'Registered in a year',
};

export const FLAG_KIND_LABEL: Record<SupportFlagKind, string> = {
  billing: 'Billing',
  access: 'Access',
  'data-correction': 'Data correction',
  complaint: 'Complaint',
};

export const EVENT_LABEL: Record<AccountEventKind, string> = {
  'sign-in': 'Signed in',
  'sign-in-failed': 'Failed sign-in',
  'booking-made': 'Appointment booked',
  'booking-cancelled': 'Appointment cancelled',
  'messages-sent': 'Messages sent',
  'consent-change': 'Consent changed',
  'credential-reset': 'Credential reset sent',
  'account-locked': 'Account locked',
  'account-unlocked': 'Account unlocked',
  'account-deactivated': 'Account deactivated',
  'account-reactivated': 'Account reactivated',
  'access-granted': 'Access granted',
  'access-revoked': 'Access revoked',
};

/** Events an administrator caused read differently from ones the patient did. */
export const ADMINISTRATIVE_EVENTS: readonly AccountEventKind[] = [
  'credential-reset',
  'account-locked',
  'account-unlocked',
  'account-deactivated',
  'account-reactivated',
  'access-granted',
  'access-revoked',
];

export function isAdministrative(kind: AccountEventKind): boolean {
  return ADMINISTRATIVE_EVENTS.includes(kind);
}

/* ── Formatters ───────────────────────────────────────────────── */

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatDateWith(date, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Carries the year only when it is not the current one (see ADM-03). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return formatDateWith(date, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `3 h ago` · `2 d ago` — last-activity reads better as a distance. */
export function formatSince(iso: string, now: number): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return iso;
  const ms = Math.max(0, now - at);
  if (ms < 60 * 60_000) {
    const minutes = Math.max(1, Math.floor(ms / 60_000));
    return `${String(minutes)} min ago`;
  }
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${String(hours)} h ago`;
  return `${String(Math.floor(hours / 24))} d ago`;
}
