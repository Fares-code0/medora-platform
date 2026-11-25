/**
 * Who may read a file — API §17.2's "owner/scoped", RM M25.
 *
 * ## The answer is always the subject's answer, never the file's
 *
 * A file has no access rules of its own. A lab attachment is reachable
 * by whoever may reach the order's patient; a message attachment by
 * whoever is in the thread. So this service resolves the file's
 * **subject** and then asks the platform's existing authority about it —
 * `PatientScopeService` for the care relationship (ADR-022),
 * `PatientSelfScopeService` for a patient reading their own (ADR-030).
 * Nothing here invents a second authorization model.
 *
 * ## Unreachable is 404, never 403
 *
 * Inherited from `PatientScopeService`, and the reason is unchanged: a
 * 403 confirms the file exists. Walking file ids against a 403/404 split
 * would tell an attacker how many documents a clinic holds, and for a
 * file id that came from a leaked link it would confirm the link was
 * real. The refusal is indistinguishable from "no such file".
 *
 * ## An unlinked file is reachable by its uploader and nobody else
 *
 * A file exists for a moment between `POST /files` and the row that
 * links it to a record, and some files are never linked at all. During
 * that window it has no subject, so the only defensible answer is the
 * uploader — which is also API §17.3's rule for delete.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import {
  PatientScopeService,
  PatientSelfScopeService,
  PermissionResolver,
  principalOf,
} from '../../../shared/authz';
import { FileRepository, type FileRow } from '../repositories/file.repository';

/**
 * Kinds that every signed-in user may read.
 *
 * Both are chrome rather than content. An avatar is rendered beside a
 * name in every list in the product, and a branding asset is on the
 * sign-in page — scoping either would mean a broken image wherever the
 * viewer is not the subject. Neither can carry PHI: `profile_photo` is a
 * staff member's own portrait and `branding_asset` is the clinic's logo.
 */
const PUBLICLY_READABLE = new Set(['profile_photo', 'branding_asset']);

@Injectable()
export class FileAccessService {
  constructor(
    private readonly files: FileRepository,
    private readonly patientScope: PatientScopeService,
    private readonly selfScope: PatientSelfScopeService,
    private readonly permissions: PermissionResolver,
  ) {}

  /** The file, if this caller may read it. 404 in every other case. */
  async readable(user: AuthenticatedUser, fileId: string): Promise<FileRow> {
    const file = await this.files.find(fileId);

    if (file === null) throw notFound();
    if (await this.canRead(user, file)) return file;

    throw notFound();
  }

  /**
   * API §17.3 — delete is **owner only**, and deliberately narrower than
   * read.
   *
   * A doctor in care scope may read a patient's document; removing it is
   * a different act. §17.3 says "owner", and the conservative reading is
   * the one to be wrong about — a wrongly refused delete is an
   * inconvenience, a wrongly permitted one destroys a clinical record's
   * attachment.
   */
  async deletable(user: AuthenticatedUser, fileId: string): Promise<FileRow> {
    const file = await this.files.find(fileId);

    if (file === null || file.uploadedBy !== user.id) throw notFound();
    // F-09: outside clinical standing, only its own verification documents.
    if (file.kind !== 'verification_document' && !(await this.inStanding(user))) throw notFound();

    return file;
  }

  private async canRead(user: AuthenticatedUser, file: FileRow): Promise<boolean> {
    // F-09: outside clinical standing, an account reads only its own
    // verification documents and the public kinds — not even a clinical
    // file it uploaded while it still had standing.
    if (!(await this.inStanding(user))) {
      return PUBLICLY_READABLE.has(file.kind) || (file.kind === 'verification_document' && file.uploadedBy === user.id);
    }

    // The uploader, always. Checked first because it needs no query.
    if (file.uploadedBy === user.id) return true;
    if (PUBLICLY_READABLE.has(file.kind)) return true;

    switch (file.kind) {
      case 'patient_document':
        return this.reachesPatient(user, file, await this.files.patientForDocument(file.id));
      case 'record_attachment':
        return this.reachesPatient(user, file, await this.files.patientForRecordAttachment(file.id));
      case 'lab_attachment':
        return this.reachesPatient(user, file, await this.files.patientForLabAttachment(file.id));
      case 'message_attachment':
        return (await this.files.participantsForMessageAttachment(file.id)).includes(user.id);
      case 'verification_document':
        // The doctor it describes, or an administrator who may act on
        // the verification decision (API §3.6). Not every admin — the
        // capability is the rule, as it is on the decision route.
        //
        // Decided by the live permission set, never the token's claim: a
        // revoked `doctors.verify` must stop working on the next request,
        // not when the access token expires (audit A-3 / §2.8).
        return (
          (await this.files.userForVerificationDocument(file.id)) === user.id ||
          (await this.permissions.can(principalOf(user), 'doctors.verify'))
        );
      default:
        // `backup_artifact`, and anything a later migration adds to the
        // CHECK. Deny: a kind whose scoping nobody has decided is not a
        // kind to guess about, and the guess would be a PHI disclosure.
        return false;
    }
  }

  /** Whether the account holds clinical standing (always, for roles that are not standing-gated). */
  async inStanding(user: AuthenticatedUser): Promise<boolean> {
    return (await this.permissions.standingFor(user.id, user.role)) === 'clinical';
  }

  /**
   * DR-05 at resource level (F-01, F-14): a clinician reads a patient's file
   * only when it belongs to the hospital where they reach the patient — a
   * file another hospital holds, or one no hospital has adopted, is not
   * theirs. Or the patient reading their own file.
   */
  private async reachesPatient(
    user: AuthenticatedUser,
    file: FileRow,
    patientId: string | null,
  ): Promise<boolean> {
    if (patientId === null) return false;

    const principal = principalOf(user);

    if (principal.roleCode === 'doctor') {
      const reach = await this.patientScope.reachAt(principal, patientId).catch(() => null);
      if (reach !== null) return file.hospitalId !== null && file.hospitalId === reach.hospitalId;
    }

    return (await this.selfScope.patientIdFor(principal)) === patientId;
  }
}

function notFound(): AppException {
  return AppException.notFound('File not found');
}
