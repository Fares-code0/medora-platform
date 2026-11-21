import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can } from '../../../shared/authz';
import type {
  AdminDoctorDetail,
  PracticeStatusResult,
  VerificationResult,
} from '../dto/admin-doctor.dto';
import {
  adminDoctorQuerySchema,
  approveDocumentSchema,
  decisionReasonSchema,
  requestDocumentsSchema,
  type AdminDoctorQuery,
  type ApproveDocumentInput,
  type DecisionReasonInput,
  type RequestDocumentsInput,
} from '../dto/admin-doctor.schema';
import {
  AdminDoctorService,
  type PaginatedAdminDoctors,
} from '../services/admin-doctor.service';

/**
 * The administrator's doctor surface (RM M9.3, M9.5 — API §3.4–3.7).
 *
 * ## Two capabilities, and the split is not cosmetic
 *
 * The contract gives the roster and the suspension lever to
 * `doctors.manage`, and the **verification decisions** to
 * `doctors.verify`. They are separate capabilities in the matrix
 * precisely so a clinic can let an office manager run the roster without
 * letting them attest that a practitioner's licence is genuine. This
 * controller honours that per route rather than guarding the class:
 * one class-level `@Can` would have to be the weaker of the two, and
 * whichever it was, half the routes would be wrong.
 *
 * ## `doctorId` is the `doctors.id` uuid, not a `usr_…` handle
 *
 * `doctors` has no public id column — the patient-facing routes already
 * quote `doctors.id` — so the administrator surface does the same rather
 * than inventing a second identifier for one module.
 *
 * ## No frontend consumer yet
 *
 * ADM-02/ADM-03 (`/admin/doctors`) are unbuilt (M39.6), which RM M9.5
 * flags explicitly: "verify by contract test, not by UI". That is what
 * `doctor-administration.e2e-spec.ts` does.
 */
@Controller('doctors')
export class AdminDoctorController {
  constructor(private readonly doctors: AdminDoctorService) {}

  /** API §3.4 — the roster with its four operational columns. */
  @Can('doctors.manage')
  @Get()
  list(
    @Query(zodQuery(adminDoctorQuerySchema)) query: AdminDoctorQuery,
  ): Promise<PaginatedAdminDoctors> {
    return this.doctors.list(query);
  }

  /** API §3.5 — the detail, carrying `affectedAppointments` for §3.7. */
  @Can('doctors.manage')
  @Get(':doctorId')
  detail(@Param('doctorId') doctorId: string): Promise<AdminDoctorDetail> {
    return this.doctors.detail(doctorId);
  }

  /**
   * API §3.6 — complete verification.
   *
   * 409 with the outstanding document kinds when the gate is not met.
   * RM M9.3 words it as the button being "enabled only when all required
   * docs approved"; an enabled button is a client-side courtesy, and the
   * refusal has to live here or it is not a gate.
   */
  @Can('doctors.verify')
  @Post(':doctorId/verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
  ): Promise<VerificationResult> {
    return this.doctors.verify(actor, doctorId);
  }

  /** API §3.6 — reject the whole verification, with a reason (P4). */
  @Can('doctors.verify')
  @Post(':doctorId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Body(zodBody(decisionReasonSchema)) body: DecisionReasonInput,
  ): Promise<VerificationResult> {
    return this.doctors.reject(actor, doctorId, body);
  }

  /** API §3.6 — ask for more documents, with a reason (P4). */
  @Can('doctors.verify')
  @Post(':doctorId/request-documents')
  @HttpCode(HttpStatus.OK)
  requestDocuments(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Body(zodBody(requestDocumentsSchema)) body: RequestDocumentsInput,
  ): Promise<VerificationResult> {
    return this.doctors.requestDocuments(actor, doctorId, body);
  }

  /**
   * API §3.6 — approve one document.
   *
   * The three checklist booleans are the reviewer's attestation (DB
   * §S1) and all three are `z.literal(true)`: a document approved with
   * `identityMatch` false is one the reviewer has said does not belong
   * to this person.
   */
  @Can('doctors.verify')
  @Post(':doctorId/documents/:documentId/approve')
  @HttpCode(HttpStatus.OK)
  approveDocument(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Param('documentId') documentId: string,
    @Body(zodBody(approveDocumentSchema)) body: ApproveDocumentInput,
  ): Promise<AdminDoctorDetail> {
    return this.doctors.approveDocument(actor, doctorId, documentId, body);
  }

  /** API §3.6 — reject one document, with a reason (P4). */
  @Can('doctors.verify')
  @Post(':doctorId/documents/:documentId/reject')
  @HttpCode(HttpStatus.OK)
  rejectDocument(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Param('documentId') documentId: string,
    @Body(zodBody(decisionReasonSchema)) body: DecisionReasonInput,
  ): Promise<AdminDoctorDetail> {
    return this.doctors.rejectDocument(actor, doctorId, documentId, body);
  }

  /**
   * API §3.7 — suspend, with a reason (P4).
   *
   * The response carries `affectedAppointments`, counted **before** the
   * write, so the client can reconcile the number it showed on the
   * confirmation dialog with the one the decision actually touched.
   */
  @Can('doctors.manage')
  @Post(':doctorId/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Body(zodBody(decisionReasonSchema)) body: DecisionReasonInput,
  ): Promise<PracticeStatusResult> {
    return this.doctors.suspend(actor, doctorId, body);
  }

  /** API §3.7 — reactivate. No reason: restoring access is not destructive. */
  @Can('doctors.manage')
  @Post(':doctorId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
  ): Promise<PracticeStatusResult> {
    return this.doctors.reactivate(actor, doctorId);
  }
}
