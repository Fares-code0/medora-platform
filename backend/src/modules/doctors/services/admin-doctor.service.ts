/**
 * The verification lifecycle and the administrator's roster
 * (RM M9.3, M9.5 — API §3.4–3.7).
 *
 * ## The state machine, and where the gate actually is
 *
 * `DoctorVerificationStatus` has four members and this service is the
 * only thing that moves between them:
 *
 * ```text
 *   pending ──approve all required docs──▶ verified
 *      │                                      │
 *      ├──request-documents──▶ docs_requested ┘
 *      └──reject────────────▶ rejected ───reapply──▶ pending
 * ```
 *
 * **Verification is gated on the documents, not on a checkbox.** RM M9.3
 * says complete-verification is "enabled only when all required docs
 * approved", and an *enabled* button is a client-side courtesy — the
 * server refuses the transition, with 409 and a list of what is still
 * outstanding. A gate that only the UI enforces is not a gate; it is a
 * disabled button someone can curl past.
 *
 * A document is approved only with all three of DB §S1's checklist
 * booleans true, because a document approved with `identityMatch` false
 * is one the reviewer has said does not belong to this person.
 *
 * ## Every decision here is P4: reason required, audited, notified
 *
 * Rejection and request-documents take a mandatory `reason`; suspension
 * does too. The reason is what survives into the audit trail — an
 * optional one would be an optional audit trail — and the doctor is
 * notified through `shared/outbox` rather than by calling the
 * notifications module, which M2.2's zone 1 forbids and which would roll
 * the notification back with this transaction anyway.
 *
 * ## Suspension is `practice_status`, not the account
 *
 * A suspended practitioner keeps their `users` row, their sessions and
 * their login. `doctors.practice_status = SUSPENDED` takes them out of
 * the patient-facing directory (`PatientDoctorRepository` filters on it)
 * and is the lever a clinic pulls when practising rights are in
 * question. Closing the *account* is `PATCH /admin/users/{id}` at M8.2,
 * a different decision with a different consequence, and conflating the
 * two would mean a clinic could not suspend a doctor without also
 * cutting off their access to their own records.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type {
  DoctorPracticeStatus,
  DoctorVerificationStatus,
} from '../../../generated/prisma/enums';
import type {
  AdminDoctorDetail,
  AdminDoctorSummary,
  PracticeStatusResult,
  VerificationDocumentView,
  VerificationResult,
} from '../dto/admin-doctor.dto';
import {
  REQUIRED_VERIFICATION_DOCUMENTS,
  type AdminDoctorQuery,
  type ApproveDocumentInput,
  type DecisionReasonInput,
  type RequestDocumentsInput,
} from '../dto/admin-doctor.schema';
import {
  AdminDoctorRepository,
  type AdminDoctorDetailRow,
  type AdminDoctorSummaryRow,
} from '../repositories/admin-doctor.repository';

export interface PaginatedAdminDoctors {
  readonly items: readonly AdminDoctorSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class AdminDoctorService {
  constructor(
    private readonly doctors: AdminDoctorRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /** API §3.4 — the roster, with the four operational columns. */
  /** S5: `hospitalId` — a Hospital Admin's roster; `null` — every doctor. */
  async list(query: AdminDoctorQuery, hospitalId: string | null): Promise<PaginatedAdminDoctors> {
    const { rows, totalItems } = await this.doctors.list({
      ...(hospitalId === null ? {} : { hospitalId }),
      q: query.q,
      specialtyId: query.specialtyId,
      departmentId: query.departmentId,
      verification:
        query.verification === undefined
          ? undefined
          : VERIFICATION_FROM_WIRE[query.verification],
      status: query.status === undefined ? undefined : PRACTICE_FROM_WIRE[query.status],
      joinedFrom: query.joinedFrom === undefined ? undefined : new Date(query.joinedFrom),
      joinedTo: query.joinedTo === undefined ? undefined : new Date(query.joinedTo),
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });

    // One batched query for the page rather than two per row — a 100-row
    // page would otherwise be 200 round trips.
    const stats = await this.doctors.statisticsFor(rows.map((row) => row.id));

    return {
      items: rows.map((row) =>
        toSummary(row, stats[row.id] ?? { patientsCount: 0, appointments30d: 0 }),
      ),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /** API §3.5 — the detail, including the suspension consequence count. */
  async detail(doctorId: string): Promise<AdminDoctorDetail> {
    const row = await this.doctors.findById(doctorId);
    if (row === null) throw AppException.notFound('Doctor not found');

    const [stats, affectedAppointments] = await Promise.all([
      this.doctors.statisticsFor([row.id]),
      this.doctors.upcomingAppointmentCount(row.id),
    ]);

    return {
      ...toSummary(row, stats[row.id] ?? { patientsCount: 0, appointments30d: 0 }),
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      officeLocation: row.officeLocation,
      officeHours: row.officeHours,
      biography: row.biography,
      yearsOfExperience: row.yearsOfExperience,
      languages: row.languages,
      education: row.education,
      certifications: row.certifications,
      skills: row.skills,
      employeeId: row.employeeId,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      documents: row.verificationDocuments.map(toDocumentView),
      affectedAppointments,
      verifiable: outstandingDocuments(row).length === 0,
    };
  }

  /** API §3.6 — complete verification. Gated on the required documents. */
  async verify(actor: AuthenticatedUser, doctorId: string): Promise<VerificationResult> {
    const row = await this.doctors.findById(doctorId);
    if (row === null) throw AppException.notFound('Doctor not found');

    const outstanding = outstandingDocuments(row);
    if (outstanding.length > 0) {
      // 409 rather than 422: the body is fine, the *state* is not. The
      // detail names what is missing so the reviewer does not have to
      // read the documents tab to find out.
      throw AppException.conflict(
        `Approve these documents first: ${outstanding.join(', ')}`,
        'invalid_status_transition',
      );
    }

    const verifiedAt = new Date();
    const updated = await this.doctors.setVerificationStatus({
      doctorId: row.id,
      status: 'VERIFIED',
      actorId: actor.id,
      verifiedAt,
    });
    if (updated === null) throw AppException.notFound('Doctor not found');

    await this.recordDecision(actor, row.id, 'doctor.verify', { status: 'verified' });
    await this.notifyDoctor(row.id, 'doctor.verified', {});
    await this.recordForDoctor(row.id, 'Your professional verification was approved');

    return toVerificationResult(row.id, updated);
  }

  /** API §3.6 — reject, with a mandatory reason (P4). */
  async reject(
    actor: AuthenticatedUser,
    doctorId: string,
    input: DecisionReasonInput,
  ): Promise<VerificationResult> {
    const row = await this.doctors.findById(doctorId);
    if (row === null) throw AppException.notFound('Doctor not found');

    const updated = await this.doctors.setVerificationStatus({
      doctorId: row.id,
      status: 'REJECTED',
      actorId: actor.id,
      // Cleared: a rejected practitioner is not a verified one, and a
      // stale `verified_at` beside `rejected` is a contradiction that
      // outlives whoever could explain it.
      verifiedAt: null,
    });
    if (updated === null) throw AppException.notFound('Doctor not found');

    await this.recordDecision(actor, row.id, 'doctor.verification_reject', {
      status: 'rejected',
      reason: input.reason,
    });
    await this.notifyDoctor(row.id, 'doctor.verification_rejected', {});
    await this.recordForDoctor(
      row.id,
      'Your professional verification was rejected',
      input.reason,
    );

    return toVerificationResult(row.id, updated);
  }

  /** API §3.6 — ask for more documents, with a reason (P4). */
  async requestDocuments(
    actor: AuthenticatedUser,
    doctorId: string,
    input: RequestDocumentsInput,
  ): Promise<VerificationResult> {
    const row = await this.doctors.findById(doctorId);
    if (row === null) throw AppException.notFound('Doctor not found');

    const updated = await this.doctors.setVerificationStatus({
      doctorId: row.id,
      status: 'DOCS_REQUESTED',
      actorId: actor.id,
      verifiedAt: null,
    });
    if (updated === null) throw AppException.notFound('Doctor not found');

    await this.recordDecision(actor, row.id, 'doctor.documents_requested', {
      status: 'docs_requested',
      kinds: input.kinds.join(' '),
      reason: input.reason,
    });
    await this.notifyDoctor(row.id, 'doctor.documents_requested', {
      kinds: input.kinds.join(' '),
    });
    await this.recordForDoctor(
      row.id,
      'More verification documents were requested',
      input.reason,
    );

    return toVerificationResult(row.id, updated);
  }

  /** API §3.6 — approve one document, all three checks attested. */
  async approveDocument(
    actor: AuthenticatedUser,
    doctorId: string,
    documentId: string,
    input: ApproveDocumentInput,
  ): Promise<AdminDoctorDetail> {
    const document = await this.doctors.findDocument(doctorId, documentId);
    // Someone else's document and a non-existent one answer the same 404.
    if (document === null) throw AppException.notFound('Document not found');

    const decided = await this.doctors.decideDocument({
      documentId: document.id,
      decision: 'approved',
      actorId: actor.id,
      checks: {
        authentic: input.authentic,
        current: input.current,
        identityMatch: input.identityMatch,
      },
    });
    if (!decided) throw AppException.notFound('Document not found');

    await this.recordDecision(actor, doctorId, 'doctor.document_approve', {
      documentId: document.id,
      kind: document.kind,
    });

    return this.detail(doctorId);
  }

  /** API §3.6 — reject one document, with a reason (P4). */
  async rejectDocument(
    actor: AuthenticatedUser,
    doctorId: string,
    documentId: string,
    input: DecisionReasonInput,
  ): Promise<AdminDoctorDetail> {
    const document = await this.doctors.findDocument(doctorId, documentId);
    if (document === null) throw AppException.notFound('Document not found');

    const decided = await this.doctors.decideDocument({
      documentId: document.id,
      decision: 'rejected',
      actorId: actor.id,
      rejectReason: input.reason,
    });
    if (!decided) throw AppException.notFound('Document not found');

    await this.recordDecision(actor, doctorId, 'doctor.document_reject', {
      documentId: document.id,
      kind: document.kind,
      reason: input.reason,
    });
    await this.notifyDoctor(doctorId, 'doctor.document_rejected', { kind: document.kind });
    await this.recordForDoctor(doctorId, 'A verification document was rejected', input.reason);

    return this.detail(doctorId);
  }

  /** API §3.7 — suspend, with a reason and the consequence count (P4). */
  async suspend(
    actor: AuthenticatedUser,
    doctorId: string,
    input: DecisionReasonInput,
  ): Promise<PracticeStatusResult> {
    return this.setPracticeStatus(actor, doctorId, 'SUSPENDED', input.reason);
  }

  /** API §3.7 — reactivate. No reason: restoring access is not destructive. */
  async reactivate(actor: AuthenticatedUser, doctorId: string): Promise<PracticeStatusResult> {
    return this.setPracticeStatus(actor, doctorId, 'ACTIVE', undefined);
  }

  private async setPracticeStatus(
    actor: AuthenticatedUser,
    doctorId: string,
    status: DoctorPracticeStatus,
    reason: string | undefined,
  ): Promise<PracticeStatusResult> {
    const row = await this.doctors.findById(doctorId);
    if (row === null) throw AppException.notFound('Doctor not found');

    // Counted **before** the write. After it the number is the same
    // today, but a later change that cascaded onto appointments would
    // silently make the reported consequence zero — and the count is the
    // whole point of the confirmation dialog.
    const affectedAppointments = await this.doctors.upcomingAppointmentCount(row.id);

    const updated = await this.doctors.setPracticeStatus({
      doctorId: row.id,
      status,
      actorId: actor.id,
    });
    if (updated === null) throw AppException.notFound('Doctor not found');

    await this.recordDecision(actor, row.id, `doctor.${status === 'ACTIVE' ? 'reactivate' : 'suspend'}`, {
      practiceStatus: PRACTICE_TO_WIRE[updated.practiceStatus],
      affectedAppointments,
      ...(reason === undefined ? {} : { reason }),
    });

    await this.notifyDoctor(
      row.id,
      status === 'ACTIVE' ? 'doctor.reactivated' : 'doctor.suspended',
      { affectedAppointments },
    );
    await this.recordForDoctor(
      row.id,
      status === 'ACTIVE'
        ? 'Your practice was reactivated'
        : 'Your practice was suspended by an administrator',
      reason,
    );

    return {
      doctorId: row.id,
      practiceStatus: PRACTICE_TO_WIRE[updated.practiceStatus],
      affectedAppointments,
    };
  }

  private async recordDecision(
    actor: AuthenticatedUser,
    doctorId: string,
    action: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> {
    await this.audit.record({
      action,
      actor: { userId: actor.id, role: actor.role },
      entityType: 'doctor',
      entityId: doctorId,
      metadata,
    });
  }

  /**
   * Tells the doctor, through the outbox.
   *
   * Not by calling the notifications module: M2.2's zone 1 forbids it,
   * and a direct call would tie the notification's fate to this
   * request's. The payload carries identifiers only (MG §11.6) — the
   * reason a verification was rejected is in the doctor's own activity
   * feed and in the audit ledger, both of which are access-controlled;
   * an outbox payload is not the place for it.
   */
  private async notifyDoctor(
    doctorId: string,
    topic: string,
    payload: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> {
    const userId = await this.doctors.userIdFor(doctorId);
    if (userId === null) return;

    await this.outbox.publish({
      topic,
      payload: { doctorId, userId, ...payload },
      // At-least-once delivery: a consumer must be able to recognise a
      // message it already handled. Doctor plus topic plus the minute is
      // enough — two identical decisions inside one minute are the same
      // decision pressed twice.
      dedupeKey: `${topic}:${doctorId}:${String(Math.floor(Date.now() / 60_000))}`,
    });
  }

  /** The doctor's own feed. `security` — it is a change to their standing. */
  private async recordForDoctor(
    doctorId: string,
    summary: string,
    detail?: string,
  ): Promise<void> {
    const userId = await this.doctors.userIdFor(doctorId);
    if (userId === null) return;

    await this.activity.record({
      userId,
      kind: 'security',
      summary,
      ...(detail === undefined ? {} : { detail }),
    });
  }
}

/**
 * Required documents that are not approved (RM M9.3).
 *
 * A missing document and a pending one are both outstanding — the gate
 * is "approved", not "uploaded". Returning the kinds rather than a
 * boolean is what lets the 409 say which ones.
 */
function outstandingDocuments(row: AdminDoctorDetailRow): readonly string[] {
  return REQUIRED_VERIFICATION_DOCUMENTS.filter(
    (kind) =>
      !row.verificationDocuments.some(
        (document) => document.kind === kind && document.decision === 'approved',
      ),
  );
}

function toSummary(
  row: AdminDoctorSummaryRow,
  stats: { patientsCount: number; appointments30d: number },
): AdminDoctorSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    title: row.title,
    specialty: row.specialty,
    departmentName: row.department?.name ?? null,
    licenseNumber: row.licenseNumber,
    // A `date` column: the time half is meaningless and a full ISO
    // timestamp would invite a client to apply its own zone to it.
    licenseExpiresOn: row.licenseExpiresOn?.toISOString().slice(0, 10) ?? null,
    professionalCategory: row.professionalCategory,
    verificationStatus: VERIFICATION_TO_WIRE[row.verificationStatus],
    practiceStatus: PRACTICE_TO_WIRE[row.practiceStatus],
    // `Decimal` on the wire would serialise as an object; the column is
    // `decimal(3,2)` so a float carries it exactly.
    ratingAvg: row.ratingAvg === null ? null : Number(row.ratingAvg),
    // `row.user` is typed non-nullable — `doctors.user_id` is NOT NULL
    // and the relation CASCADEs — and it is null anyway when the account
    // has been **soft-deleted**: the soft-delete client extension
    // (ADR-021) applies its `deleted_at IS NULL` filter to nested reads,
    // so the join comes back empty for a row the type says must be
    // there. Without this guard the whole roster answers 500 the moment
    // one account is soft-deleted, which is a page an administrator
    // needs most when accounts are being removed.
    lastActiveAt: row.user?.lastActiveAt?.toISOString() ?? null,
    joinedAt: row.createdAt.toISOString(),
    patientsCount: stats.patientsCount,
    appointments30d: stats.appointments30d,
  };
}

/**
 * One verification document on the wire. Shared with the doctor's own
 * route (`DoctorVerificationService`), so the doctor and the reviewer
 * read one shape for one row.
 */
export function toDocumentView(
  row: AdminDoctorDetailRow['verificationDocuments'][number],
): VerificationDocumentView {
  return {
    id: row.id,
    kind: row.kind,
    fileId: row.fileId,
    uploadedAt: row.uploadedAt.toISOString(),
    expiresOn: row.expiresOn?.toISOString().slice(0, 10) ?? null,
    decision: row.decision,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason,
    checks: {
      authentic: row.checkAuthentic,
      current: row.checkCurrent,
      identityMatch: row.checkIdentityMatch,
    },
  };
}

function toVerificationResult(
  doctorId: string,
  updated: { verificationStatus: DoctorVerificationStatus; verifiedAt: Date | null },
): VerificationResult {
  return {
    doctorId,
    verificationStatus: VERIFICATION_TO_WIRE[updated.verificationStatus],
    verifiedAt: updated.verifiedAt?.toISOString() ?? null,
  };
}

/** ADR-023 §2 — `DOCS_REQUESTED` is `docs_requested`, not `docs-requested`. */
const VERIFICATION_TO_WIRE: Record<DoctorVerificationStatus, string> = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  DOCS_REQUESTED: 'docs_requested',
};

const VERIFICATION_FROM_WIRE: Readonly<Record<string, DoctorVerificationStatus>> = {
  pending: 'PENDING',
  verified: 'VERIFIED',
  rejected: 'REJECTED',
  docs_requested: 'DOCS_REQUESTED',
};

const PRACTICE_TO_WIRE: Record<DoctorPracticeStatus, string> = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  VACATION: 'vacation',
};

const PRACTICE_FROM_WIRE: Readonly<Record<string, DoctorPracticeStatus>> = {
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
  vacation: 'VACATION',
};
