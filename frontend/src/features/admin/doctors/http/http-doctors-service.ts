import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  malformedResponse,
  notConnected,
  readArray,
  readBoolean,
  readData,
  readEnum,
  readNumber,
  readOptionalDay,
  readOptionalNumber,
  readOptionalString,
  readPage,
  readString,
} from '@/api/http';
import { isApiError } from '@/types/api';

import type { AdminDoctorsService } from '../api/doctors-service';
import type {
  AccountStatus,
  CredentialDocument,
  DocumentChecklist,
  DocumentDecision,
  DoctorRecord,
  DocumentKind,
  RequestableDocumentKind,
  VerificationStatus,
} from '../doctors.types';

/**
 * Doctors management over HTTP (FE-10.10) — API §3.4–3.7,
 * `backend/src/modules/doctors/controllers/admin-doctor.controller.ts`.
 *
 * | Port method            | Endpoint                                              |
 * | ---------------------- | ----------------------------------------------------- |
 * | `list`                 | `GET /doctors` (every page)                           |
 * | `detail`               | `GET /doctors/{id}`                                   |
 * | `pendingVerifications` | `GET /doctors?verification=pending&pageSize=1`        |
 * | `approveDocument`      | `POST /doctors/{id}/documents/{docId}/approve`        |
 * | `rejectDocument`       | `POST /doctors/{id}/documents/{docId}/reject`         |
 * | `completeVerification` | `POST /doctors/{id}/verify`                           |
 * | `requestDocuments`     | `POST /doctors/{id}/request-documents`                |
 * | `rejectApplication`    | `POST /doctors/{id}/reject`                           |
 * | `suspend`              | `POST /doctors/{id}/suspend`                          |
 * | `reactivate`           | `POST /doctors/{id}/reactivate`                       |
 *
 * Not served, and answered as not connected rather than as a quiet success:
 * doctor invitations (doctors self-register), access resets, reopening a
 * rejected application, and the role-template/clinic fields. The
 * capabilities say so, so the screens do not offer them.
 *
 * ## What a live record does not carry
 *
 * The roster serves four operational columns and no history: no sign-in
 * log, no activity counts, no rating distribution, no audit trail, no
 * suspension or request note. Those fields are empty or `null` — never
 * zeros, which would read as "nothing happened" — and the profile hides the
 * tabs that would show them. The credential documents arrive with the
 * detail only, so a roster row has none until its profile is opened.
 *
 * ## The checklist is the reviewer's, until they approve
 *
 * The API takes the three checks as the approve call's body, all `true`,
 * and stores no partial ticks. The ticks an administrator makes before
 * approving are kept here, in memory for this session — never in storage —
 * and laid over the document they belong to, so the approve button can
 * wait for all three exactly as it does in the demo.
 */

const VERIFICATION_FROM_WIRE: Readonly<Record<string, VerificationStatus>> = {
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
  docs_requested: 'docs-requested',
};

const ACCOUNT_STATUSES: readonly AccountStatus[] = ['active', 'suspended', 'vacation'];
const DECISIONS: readonly DocumentDecision[] = ['pending', 'approved', 'rejected'];

const KIND_FROM_WIRE: Readonly<Record<string, DocumentKind>> = {
  medical_license: 'medical-license',
  degree_certificate: 'degree',
  national_id: 'identity',
  other: 'other',
};

const KIND_TO_WIRE: Readonly<Record<RequestableDocumentKind, string>> = {
  'medical-license': 'medical_license',
  degree: 'degree_certificate',
  identity: 'national_id',
  other: 'other',
};

/** Ticks made but not yet submitted, by document id. Session memory only. */
const pendingTicks = new Map<string, DocumentChecklist>();

const NO_TICKS: DocumentChecklist = { authentic: false, current: false, matchesIdentity: false };

function readMapped<T>(
  record: Record<string, unknown>,
  key: string,
  map: Readonly<Record<string, T>>,
  what: string,
): T {
  const mapped = map[readString(record, key, what)];
  if (mapped === undefined) throw malformedResponse(`${what}.${key}`);
  return mapped;
}

function readStrings(
  record: Record<string, unknown>,
  key: string,
  what: string,
): readonly string[] {
  const values = readArray(record, key, what);
  if (!values.every((value): value is string => typeof value === 'string')) {
    throw malformedResponse(`${what}.${key}`);
  }
  return values;
}

function toDocument(value: unknown): CredentialDocument {
  const what = 'doctor document';
  const dto = asRecord(value, what);
  const checks = asRecord(dto.checks, `${what}.checks`);
  const id = readString(dto, 'id', what);
  const decision = readEnum(dto, 'decision', DECISIONS, what);
  const decided: DocumentChecklist = {
    authentic: readBoolean(checks, 'authentic', `${what}.checks`),
    current: readBoolean(checks, 'current', `${what}.checks`),
    matchesIdentity: readBoolean(checks, 'identityMatch', `${what}.checks`),
  };
  return {
    id,
    kind: readMapped(dto, 'kind', KIND_FROM_WIRE, what),
    // The API stores the scan by file id, with no display name to show.
    filename: null,
    uploadedAt: readString(dto, 'uploadedAt', what),
    expiresAt: readOptionalDay(dto, 'expiresOn', what),
    decision,
    checklist: decision === 'pending' ? (pendingTicks.get(id) ?? NO_TICKS) : decided,
    rejectionReason: readOptionalString(dto, 'rejectReason', what),
    // The decision is attributed in the audit ledger, not on this view.
    reviewedBy: null,
    reviewedAt: readOptionalString(dto, 'decidedAt', what),
    // No stored-file reader in the API: the profile offers no preview.
    previewLines: [],
  };
}

/** The roster's columns, as a record with no history attached. */
export function toDoctorSummary(value: unknown): DoctorRecord {
  const what = 'doctor';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'fullName', what),
    title: readOptionalString(dto, 'title', what) ?? '',
    // Contact details are on the detail only (API §3.5), deliberately.
    email: '',
    phone: '',
    specialty: readString(dto, 'specialty', what),
    licenseNumber: readString(dto, 'licenseNumber', what),
    languages: [],
    bio: '',
    joinedAt: readString(dto, 'joinedAt', what),
    lastActiveAt: readOptionalString(dto, 'lastActiveAt', what),
    verification: readMapped(dto, 'verificationStatus', VERIFICATION_FROM_WIRE, what),
    verificationNote: null,
    account: readEnum(dto, 'practiceStatus', ACCOUNT_STATUSES, what),
    suspensionReason: null,
    administrative: null,
    patientsCount: readNumber(dto, 'patientsCount', what),
    appointments30d: readNumber(dto, 'appointments30d', what),
    rating: readOptionalNumber(dto, 'ratingAvg', what),
    licenseExpiresAt: readOptionalDay(dto, 'licenseExpiresOn', what),
    documents: [],
    logins: [],
    activity: null,
    statistics: null,
    audit: [],
  };
}

/** The detail: the roster's columns plus contact details and documents. */
export function toDoctorDetail(value: unknown): DoctorRecord {
  const what = 'doctor detail';
  const dto = asRecord(value, what);
  return {
    ...toDoctorSummary(dto),
    email: readString(dto, 'contactEmail', what),
    phone: readString(dto, 'contactPhone', what),
    languages: readStrings(dto, 'languages', what),
    bio: readOptionalString(dto, 'biography', what) ?? '',
    documents: readArray(dto, 'documents', what).map(toDocument),
  };
}

function doctorPath(doctorId: string, action?: string): string {
  const base = `/doctors/${encodeURIComponent(doctorId)}`;
  return action === undefined ? base : `${base}/${action}`;
}

function documentPath(doctorId: string, documentId: string, action: string): string {
  return `${doctorPath(doctorId)}/documents/${encodeURIComponent(documentId)}/${action}`;
}

/** Every write re-reads from the server; see the port's doc comment. */
async function write(call: () => Promise<unknown>): Promise<null> {
  await call();
  return null;
}

export const httpDoctorsService: AdminDoctorsService = {
  capabilities: {
    invite: false,
    resetAccess: false,
    returnToReview: false,
    administrativeFields: false,
  },

  async list() {
    const items = await fetchAllPages(
      (page, pageSize) => apiClient.get('/doctors', { page, pageSize }),
      'doctors',
    );
    // No route lists doctor invitations — there are none to list.
    return { doctors: items.map(toDoctorSummary), invites: [] };
  },

  async detail(doctorId) {
    try {
      return toDoctorDetail(readData(await apiClient.get(doctorPath(doctorId)), 'doctor detail'));
    } catch (error) {
      if (isApiError(error) && error.kind === 'not_found') return null;
      throw error;
    }
  },

  async pendingVerifications() {
    const page = readPage(
      await apiClient.get('/doctors', { verification: 'pending', page: 1, pageSize: 1 }),
      'pending verifications',
    );
    return page.totalItems;
  },

  setCheck({ documentId, field, value }) {
    const current = pendingTicks.get(documentId) ?? NO_TICKS;
    pendingTicks.set(documentId, { ...current, [field]: value });
    return Promise.resolve(null);
  },

  async approveDocument({ doctorId, documentId }) {
    // The body is the reviewer's attestation; the button that calls this is
    // enabled only once all three are ticked (`canApproveDocument`).
    const result = await write(() =>
      apiClient.post(documentPath(doctorId, documentId, 'approve'), {
        authentic: true,
        current: true,
        identityMatch: true,
      }),
    );
    pendingTicks.delete(documentId);
    return result;
  },

  async rejectDocument({ doctorId, documentId, reason = '' }) {
    const result = await write(() =>
      apiClient.post(documentPath(doctorId, documentId, 'reject'), { reason: reason.trim() }),
    );
    pendingTicks.delete(documentId);
    return result;
  },

  completeVerification: ({ doctorId }) =>
    write(() => apiClient.post(doctorPath(doctorId, 'verify'))),

  requestDocuments: ({ doctorId, kinds, reason = '' }) =>
    write(() =>
      apiClient.post(doctorPath(doctorId, 'request-documents'), {
        kinds: kinds.map((kind) => KIND_TO_WIRE[kind]),
        reason: reason.trim(),
      }),
    ),

  rejectApplication: ({ doctorId, reason = '' }) =>
    write(() => apiClient.post(doctorPath(doctorId, 'reject'), { reason: reason.trim() })),

  suspend: ({ doctorId, reason = '' }) =>
    write(() => apiClient.post(doctorPath(doctorId, 'suspend'), { reason: reason.trim() })),

  reactivate: ({ doctorId }) => write(() => apiClient.post(doctorPath(doctorId, 'reactivate'))),

  returnToReview: () => Promise.reject(notConnected('Reopening a rejected application')),
  resetAccess: () => Promise.reject(notConnected('Doctor access resets')),
  updateAdministrative: () => Promise.reject(notConnected('Doctor role templates and clinics')),
  invite: () => Promise.reject(notConnected('Doctor invitations')),
};

/** Test seam: forget the session's unsubmitted ticks. */
export function __resetHttpDoctorTicks(): void {
  pendingTicks.clear();
}
