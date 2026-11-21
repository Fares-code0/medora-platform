import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import type { VerificationDocumentView } from '../dto/admin-doctor.dto';
import type { SubmitVerificationDocumentInput } from '../dto/doctor-verification.schema';
import {
  DoctorVerificationRepository,
  VerificationUploadAlreadyFiled,
  VerificationUploadUnavailable,
} from '../repositories/doctor-verification.repository';

import { toDocumentView } from './admin-doctor.service';

/**
 * A doctor's own verification documents — frontend checklist NEW-46.
 *
 * `POST /doctors/:id/verify` answers 409 until every required document
 * is approved, and until this route nothing could create one: a doctor
 * who registered could never be verified. This is the doctor's half —
 * list what has been filed, file an upload — and nothing more.
 *
 * **What it deliberately does not do:**
 * - It does not move `doctors.verification_status`. A submission is
 *   evidence for the reviewer, not a decision, and which status a
 *   resubmission after `docs_requested` should return to is the
 *   verification state machine's question (API §3.6), not this route's.
 * - It does not replace or delete a filed document. A rejected one stays,
 *   with its reason, beside the new upload — the reviewer's record of
 *   what was refused and why.
 */
@Injectable()
export class DoctorVerificationService {
  constructor(
    private readonly documents: DoctorVerificationRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** Every document this doctor has filed, newest first, with its decision. */
  async list(user: AuthenticatedUser): Promise<readonly VerificationDocumentView[]> {
    const doctorId = await this.requireDoctor(user);

    return (await this.documents.list(doctorId)).map(toDocumentView);
  }

  /** File one upload of the caller's own as a verification document. */
  async submit(
    user: AuthenticatedUser,
    input: SubmitVerificationDocumentInput,
  ): Promise<VerificationDocumentView> {
    const doctorId = await this.requireDoctor(user);

    let row;
    try {
      row = await this.documents.submit({
        doctorId,
        uploaderId: user.id,
        fileId: input.fileId,
        kind: input.kind,
        expiresOn: input.expiresOn === undefined ? null : new Date(`${input.expiresOn}T00:00:00Z`),
      });
    } catch (error) {
      if (error instanceof VerificationUploadUnavailable) {
        throw AppException.validation(
          {
            fileId: [
              'No upload of yours with this id can be filed. Upload the file to /files ' +
                'with kind verification_document, then send the id it returns.',
            ],
          },
          'Unknown upload',
        );
      }
      if (error instanceof VerificationUploadAlreadyFiled) {
        throw AppException.conflict(
          'This upload is already filed as a verification document. Upload the file again to file a copy.',
          'verification_document_already_filed',
        );
      }
      throw error;
    }

    // The document id and kind, never the filename: a scan of a national
    // ID is named after the person on it.
    await this.audit.record({
      action: 'doctor.verification_document_upload',
      actor: { userId: user.id, role: user.role },
      entityType: 'doctor',
      entityId: doctorId,
      metadata: { documentId: row.id, kind: row.kind },
    });

    return toDocumentView(row);
  }

  /**
   * 404, not 403, for an account with no `doctors` row — the resource does
   * not exist for it, as `AvailabilityService` answers for the same case.
   */
  private async requireDoctor(user: AuthenticatedUser): Promise<string> {
    const doctorId = await this.documents.doctorIdForUser(user.id);
    if (doctorId === null) throw AppException.notFound('No doctor profile for this account');
    return doctorId;
  }
}
