/**
 * Doctors management — the pure half (ADM-02 / ADM-03 · UX §3.2, §3.3).
 *
 * The verification workflow lives here as a state machine rather than as a
 * set of buttons that happen to be disabled: what an administrator may
 * decide depends on where the doctor already sits and on whether the
 * documents actually support the decision. "Complete verification" in
 * particular is not a judgement call the UI should allow to be clicked
 * early — it is only available once every required document has been
 * approved on all three checks.
 *
 * Everything here is component-free and takes `now` as a parameter.
 * Persistence lives in `doctors.api.ts`.
 */

import type { StatusKind } from '@/components/patterns';
import { formatDateWith } from '@/i18n';

import type {
  AccountStatus,
  CredentialDocument,
  DoctorFilters,
  DoctorRecord,
  DoctorTab,
  DocumentChecklist,
  DocumentKind,
  JoinedRangeKey,
  RequestableDocumentKind,
  VerificationStatus,
} from './doctors.types';

const DAY_MS = 86_400_000;

/**
 * Documents a doctor cannot practise without. Insurance and references are
 * collected but do not block verification — the platform should not refuse
 * a licensed doctor over a missing reference letter.
 */
export const REQUIRED_DOCUMENTS: readonly DocumentKind[] = [
  'medical-license',
  'degree',
  'identity',
];

/** A licence inside this window is flagged rather than treated as valid. */
export const EXPIRY_WARNING_DAYS = 60;

/** The horizon the ADM-01 action queue counts practising credentials against. */
export const LICENCE_EXPIRY_DAYS = 30;

/** Free-text floor for a rejection, suspension, or document-request reason. */
export const REASON_MIN_LENGTH = 12;

/* ── Document rules ───────────────────────────────────────────── */

export function isChecklistComplete(checklist: DocumentChecklist): boolean {
  return checklist.authentic && checklist.current && checklist.matchesIdentity;
}

/**
 * A document may only be approved once all three checks are ticked. The
 * checklist is the evidence; approving without it would make the record say
 * an administrator verified something they did not look at.
 */
export function canApproveDocument(document: CredentialDocument): boolean {
  return document.decision !== 'approved' && isChecklistComplete(document.checklist);
}

export function isExpired(document: CredentialDocument, now: number): boolean {
  if (document.expiresAt === null) return false;
  return new Date(document.expiresAt).getTime() < now;
}

export function isExpiringSoon(document: CredentialDocument, now: number): boolean {
  if (document.expiresAt === null) return false;
  const at = new Date(document.expiresAt).getTime();
  return at >= now && at - now <= EXPIRY_WARNING_DAYS * DAY_MS;
}

/**
 * A doctor whose medical licence expires inside the horizon — or already
 * has. An expired licence counts: it is the more urgent case, not the one
 * that has fallen off the end of a window.
 *
 * Deliberately narrower than `isExpiringSoon` above, which warns at 60
 * days across every document kind. This row is about practising credentials.
 */
export function licenceExpiringSoon(doctor: DoctorRecord, now: number): boolean {
  const expiresAt = licenceExpiry(doctor);
  if (expiresAt === null) return false;
  const expires = new Date(expiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  return expires <= now + LICENCE_EXPIRY_DAYS * DAY_MS;
}

/**
 * When the medical licence expires. The roster field first — a live roster
 * row carries it without the documents (FE-10.10) — then the licence on
 * file, for a record that holds only the document.
 */
export function licenceExpiry(doctor: DoctorRecord): string | null {
  return (
    doctor.licenseExpiresAt ??
    doctor.documents.find((document) => document.kind === 'medical-license')?.expiresAt ??
    null
  );
}

export function requiredDocuments(
  documents: readonly CredentialDocument[],
): readonly CredentialDocument[] {
  return documents.filter((document) => REQUIRED_DOCUMENTS.includes(document.kind));
}

/**
 * Whether the credential file is complete: every required document present,
 * approved, and not expired. An approved-but-expired licence is not a
 * verified doctor, which is why the expiry check is here and not only in
 * the badge.
 */
export function isVerifiable(doctor: DoctorRecord, now: number): boolean {
  const required = requiredDocuments(doctor.documents);
  if (required.length < REQUIRED_DOCUMENTS.length) return false;
  return required.every(
    (document) => document.decision === 'approved' && !isExpired(document, now),
  );
}

/** What is still standing between this doctor and a completed verification. */
export function verificationBlockers(doctor: DoctorRecord, now: number): readonly string[] {
  const blockers: string[] = [];
  for (const kind of REQUIRED_DOCUMENTS) {
    const document = doctor.documents.find((entry) => entry.kind === kind);
    if (document === undefined) {
      blockers.push(`${DOCUMENT_LABEL[kind]} has not been uploaded.`);
      continue;
    }
    if (isExpired(document, now)) {
      blockers.push(`${DOCUMENT_LABEL[kind]} has expired.`);
      continue;
    }
    if (document.decision === 'rejected') {
      blockers.push(`${DOCUMENT_LABEL[kind]} was rejected.`);
      continue;
    }
    if (document.decision !== 'approved') {
      blockers.push(`${DOCUMENT_LABEL[kind]} has not been approved.`);
    }
  }
  return blockers;
}

/* ── Requesting documents ─────────────────────────────────────── */

/** The documents a request may name — the live API's four kinds (FE-10.10). */
export const REQUESTABLE_DOCUMENTS: readonly RequestableDocumentKind[] = [
  'medical-license',
  'degree',
  'identity',
  'other',
];

/**
 * The starting selection: every required document not yet approved. That
 * is what is blocking verification, so it is what the administrator most
 * likely means to ask for; they can change it.
 */
export function initialRequestKinds(doctor: DoctorRecord): readonly RequestableDocumentKind[] {
  return REQUESTABLE_DOCUMENTS.filter(
    (kind) =>
      REQUIRED_DOCUMENTS.includes(kind) &&
      !doctor.documents.some((entry) => entry.kind === kind && entry.decision === 'approved'),
  );
}

/* ── The verification state machine ───────────────────────────── */

export type VerificationDecision =
  | 'complete'
  | 'request-documents'
  | 'reject'
  | 'reinstate-review';

export interface DecisionAvailability {
  readonly decision: VerificationDecision;
  readonly enabled: boolean;
  /** Why it is unavailable — shown rather than left to guesswork. */
  readonly blockedBecause?: string;
}

/**
 * Which verification decisions apply to a doctor right now. A rejected
 * application offers only a return to review: re-deciding it directly would
 * skip the step where someone looks at the file again.
 */
export function availableDecisions(
  doctor: DoctorRecord,
  now: number,
): readonly DecisionAvailability[] {
  if (doctor.verification === 'rejected') {
    return [{ decision: 'reinstate-review', enabled: true }];
  }

  const blockers = verificationBlockers(doctor, now);
  const complete: DecisionAvailability =
    doctor.verification === 'verified'
      ? {
          decision: 'complete',
          enabled: false,
          blockedBecause: 'This doctor is already verified.',
        }
      : blockers.length === 0
        ? { decision: 'complete', enabled: true }
        : {
            decision: 'complete',
            enabled: false,
            blockedBecause: blockers[0] ?? 'The document file is incomplete.',
          };

  return [
    complete,
    { decision: 'request-documents', enabled: doctor.verification !== 'verified' },
    { decision: 'reject', enabled: doctor.verification !== 'verified' },
  ];
}

/** Suspending is only meaningful on a live account; the reverse likewise. */
export function canSuspend(doctor: DoctorRecord): boolean {
  return doctor.account !== 'suspended';
}

export function canReactivate(doctor: DoctorRecord): boolean {
  return doctor.account === 'suspended';
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
      message: `Give at least ${String(REASON_MIN_LENGTH)} characters — this is sent to the doctor.`,
    };
  }
  return { ok: true };
}

/* ── Tabs, filters and counts ─────────────────────────────────── */

/**
 * The Pending tab is the work queue, so it counts only what an administrator
 * can act on: `docs-requested` is waiting on the doctor and would otherwise
 * inflate the badge with work nobody can do.
 */
export function inTab(doctor: DoctorRecord, tab: DoctorTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'pending':
      return doctor.verification === 'pending';
    case 'active':
      return doctor.account === 'active';
    case 'suspended':
      return doctor.account === 'suspended';
  }
}

export function tabCounts(doctors: readonly DoctorRecord[]): Record<DoctorTab, number> {
  return {
    all: doctors.length,
    pending: doctors.filter((doctor) => inTab(doctor, 'pending')).length,
    active: doctors.filter((doctor) => inTab(doctor, 'active')).length,
    suspended: doctors.filter((doctor) => inTab(doctor, 'suspended')).length,
  };
}

export const EMPTY_FILTERS: DoctorFilters = {
  query: '',
  specialty: 'all',
  verification: 'all',
  account: 'all',
  joined: 'any',
  expiring: false,
};

function joinedWithin(iso: string, range: JoinedRangeKey, now: number): boolean {
  if (range === 'any') return true;
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  return now - at <= days * DAY_MS;
}

export function matchesFilters(
  doctor: DoctorRecord,
  filters: DoctorFilters,
  now: number,
): boolean {
  if (filters.specialty !== 'all' && doctor.specialty !== filters.specialty) return false;
  if (filters.verification !== 'all' && doctor.verification !== filters.verification) return false;
  if (filters.account !== 'all' && doctor.account !== filters.account) return false;
  if (!joinedWithin(doctor.joinedAt, filters.joined, now)) return false;

  const query = filters.query.trim().toLowerCase();
  if (query.length > 0) {
    const haystack = [doctor.name, doctor.email, doctor.licenseNumber, doctor.specialty]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  // The same predicate the ADM-01 queue counts on, not a copy of it: a second
  // 30-day rule would let that count and the rows it links to describe two
  // different sets of doctors.
  if (filters.expiring && !licenceExpiringSoon(doctor, now)) return false;
  return true;
}

/** Filtered, then ordered so the queue leads: pending first, then by name. */
export function filterDoctors(
  doctors: readonly DoctorRecord[],
  tab: DoctorTab,
  filters: DoctorFilters,
  now: number,
): readonly DoctorRecord[] {
  return doctors
    .filter((doctor) => inTab(doctor, tab) && matchesFilters(doctor, filters, now))
    .slice()
    .sort((a, b) => {
      const rank = (doctor: DoctorRecord) => (doctor.verification === 'pending' ? 0 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
}

/* ── Login activity ───────────────────────────────────────────── */

/** Failed and blocked sign-ins in the window — the number worth a look. */
export function failedSignInCount(doctor: DoctorRecord, sinceDays: number, now: number): number {
  return doctor.logins.filter((event) => {
    const at = new Date(event.at).getTime();
    return event.result !== 'success' && now - at <= sinceDays * DAY_MS;
  }).length;
}

export function hasImpossibleTravel(doctor: DoctorRecord): boolean {
  return doctor.logins.some((event) => event.impossibleTravel);
}

/* ── Labels & badge variants ──────────────────────────────────── */

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: 'Verified',
  pending: 'Pending',
  'docs-requested': 'Docs requested',
  rejected: 'Rejected',
};

/**
 * §3.2 specified these as raw hues (success · warning · info · error), which
 * left the platform's one status vocabulary unable to see them. Routed
 * through `StatusKind` now, so verification reads with the same encoding as
 * every other status (ADR-0001 §12).
 *
 * `docs-requested` moves off informational blue onto `awaiting`: the clinic
 * has done its part and is blocked on the doctor, which is exactly what
 * `awaiting` means and what warning-outline renders. It also stops
 * `docs-requested` and `pending` reading as unrelated states when they sit
 * in the same column.
 */
export const VERIFICATION_KIND: Record<VerificationStatus, StatusKind> = {
  /*
   * `normal`, not `confirmed`. Verification and account standing render as
   * two badges side by side on the profile header and as adjacent columns in
   * the doctors table, and `confirmed` and `active` share success-filled —
   * so "Verified" and "Active" were one treatment in the one place they are
   * read together. `normal` is also the truer reading: verification is a
   * finished process at rest, while an active account is live.
   */
  verified: 'normal',
  pending: 'pending',
  'docs-requested': 'awaiting',
  rejected: 'rejected',
};

export const ACCOUNT_LABEL: Record<AccountStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  vacation: 'Vacation',
};

/*
 * `suspended` takes `cancelled` rather than a bare alarm hue: a suspension is
 * an imposed stop, which is what the Ban glyph says, and it separates from
 * `critical` — an account under alarm — now that emphasis splits live from
 * terminal within the red family.
 */
export const ACCOUNT_KIND: Record<AccountStatus, StatusKind> = {
  active: 'active',
  suspended: 'cancelled',
  vacation: 'info',
};

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  'medical-license': 'Medical licence',
  degree: 'Degree certificate',
  identity: 'Identity document',
  insurance: 'Malpractice insurance',
  reference: 'Professional reference',
  other: 'Other supporting document',
};

export const DOCUMENT_DECISION_LABEL: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  pending: 'Awaiting review',
};

/*
 * `pending` here is labelled "Awaiting review", but it is the ADMINISTRATOR
 * who owes the review — so it is `pending` (needs our action), not `awaiting`
 * (blocked on someone else). Reading the label rather than the direction of
 * the block would have inverted it.
 */
export const DOCUMENT_DECISION_KIND: Record<string, StatusKind> = {
  approved: 'confirmed',
  rejected: 'rejected',
  pending: 'pending',
};

export const LOGIN_RESULT_LABEL: Record<string, string> = {
  success: 'Success',
  failed: 'Failed',
  blocked: 'Blocked',
};

/*
 * A login attempt is already over by the time it is rendered, so every value
 * is terminal — which is what makes this one map cleanly onto the outline
 * family. The glyphs land squarely too: Ban for an attempt the platform
 * blocked, UserRoundX for a person who failed to get in, CheckCheck for one
 * who did.
 */
export const LOGIN_RESULT_KIND: Record<string, StatusKind> = {
  success: 'completed',
  failed: 'rejected',
  blocked: 'cancelled',
};

export const DECISION_LABEL: Record<VerificationDecision, string> = {
  complete: 'Complete verification',
  'request-documents': 'Request more documents',
  reject: 'Reject application',
  'reinstate-review': 'Return to review',
};

export const TAB_LABEL: Record<DoctorTab, string> = {
  all: 'All',
  pending: 'Pending verification',
  active: 'Active',
  suspended: 'Suspended',
};

export const JOINED_RANGE_LABEL: Record<JoinedRangeKey, string> = {
  any: 'Joined any time',
  '30d': 'Joined in 30 days',
  '90d': 'Joined in 90 days',
  '365d': 'Joined in a year',
};

/** Role templates offered on invite and on the administrative fields form. */
export const ROLE_TEMPLATES: readonly string[] = [
  'Attending physician',
  'Consultant',
  'Resident',
  'Locum',
];

export const CLINICS: readonly string[] = [
  'Medora Central',
  'Medora North',
  'Medora Riverside',
  'Unassigned',
];

/* ── Formatters ───────────────────────────────────────────────── */

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatDateWith(date, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Carries the year only when it is not the current one. An administrative
 * history runs for years, and "Oct 20" sitting above "Aug 7" reads as last
 * month unless the older entry says which year it belongs to.
 */
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

/** `3 h ago` · `2 d ago` — last-active reads better as a distance. */
export function formatSince(iso: string | null, now: number): string {
  if (iso === null) return 'Never';
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

/** The queue hint under the doctors list — the verb agrees with the count ("1 doctor is"). */
export function pendingSentence(count: number): string {
  return count === 1
    ? '1 doctor is waiting on a verification decision.'
    : `${String(count)} doctors are waiting on a verification decision.`;
}
