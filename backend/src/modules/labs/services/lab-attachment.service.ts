/**
 * Attachments and attach-to-record (RM M14.7 — API §8.9, §8.11).
 *
 * ## The identity check is structural, not a dialog
 *
 * UX §2.6 asks for "attach report to patient record (confirmation with
 * patient-identity check: *Attach to Amira Saleh, MRN 4482-19?*)". The
 * frontend's `assessAttachability`
 * (`shared-domain/record-attachments/attachability.ts`) makes that a
 * real gate rather than a sentence, and says why: the failure it guards
 * against — a result filed onto the wrong patient's chart — is one of
 * the few in this product that reading the screen again does not undo.
 *
 * This is the server half, and it enforces the same five refusals for
 * the same reasons. Two of them are worth restating because they look
 * like over-strictness and are not:
 *
 * - **A matching name with a differing MRN is refused, not waved
 *   through.** It means one of the two records is wrong about who this
 *   is, which is precisely when a human should stop. The two fields are
 *   therefore compared **independently**, not as a combined score.
 * - **An order with nothing released cannot be attached.** Filing an
 *   empty report onto a chart puts a document there that says nothing
 *   and looks like it says something.
 *
 * The server's check is not a duplicate of the client's: the client
 * compares the identity the clinician ticked against the *record* it
 * chose, and this compares it against the **order's own patient**, read
 * from the database. A client with a stale patient snapshot passes its
 * own check and fails this one, which is the direction that matters.
 *
 * ## §8.11 and the M25 dependency, stated rather than worked around
 *
 * Uploading bytes goes through the `FILE_STORAGE` port. Until M25 wires
 * MinIO that port answers 503 `service_unavailable`, so §8.11 answers
 * 503 — the same answer `/api/v1/health` already gives for storage
 * (`unconfigured`, API §20.1), and the same one `registration.service`
 * and the profile-photo surface give. The alternative — writing a
 * `files` row with an invented key — would hand out ids for bytes that
 * do not exist. The `files` row is created only after `put()` resolves,
 * so the two can never disagree.
 *
 * The e2e spec binds `FILE_STORAGE` to an in-memory implementation, the
 * way RM M13.3's chaos test binds a failing `INTERACTION_SOURCE`, and
 * proves the flow end to end against a port that works. Both states are
 * tested: stored and unavailable.
 */

import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { FILE_STORAGE, type FileStoragePort } from '../../../shared/files';
import type { LabAttachmentKind } from '../../../generated/prisma/enums';
import type { LabOrderDetailView } from '../dto/lab-order.dto';
import type { AttachToRecordInput, UploadLabAttachmentInput } from '../dto/lab-order.schema';
import { LAB_ATTACHMENT_KIND_FROM_WIRE } from '../dto/labs-enums';
import { LabAttachmentRepository } from '../repositories/lab-attachment.repository';
import type { DetailRow } from '../repositories/lab-order.repository';

import { toLabOrderDetailView } from './lab-order-projection';
import { LabOrderService } from './lab-order.service';

export interface AttachToRecordResult {
  readonly recordId: string;
  readonly labOrderId: string;
  readonly attachmentIds: readonly string[];
}

@Injectable()
export class LabAttachmentService {
  constructor(
    private readonly context: LabOrderService,
    private readonly attachments: LabAttachmentRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** API §8.11 — upload a report, addendum, external result or raw data. */
  async upload(
    user: AuthenticatedUser,
    publicId: string,
    input: UploadLabAttachmentInput,
  ): Promise<LabOrderDetailView> {
    const current = await this.context.require(user, publicId);

    const content = decodeBase64(input.content);

    // The port first. A failure here — including the 503 it answers
    // until M25 — propagates before any row is written, which is what
    // keeps `files` free of rows describing bytes nobody stored.
    const stored = await this.storage.put({
      kind: 'lab_attachment',
      name: input.name,
      mimeType: input.mimeType,
      content,
    });

    const attachment = await this.attachments.attachToOrder({
      labOrderId: current.id,
      storageKey: stored.key,
      name: input.name,
      kind: LAB_ATTACHMENT_KIND_FROM_WIRE[input.kind] as LabAttachmentKind,
      mimeType: input.mimeType,
      sizeBytes: content.byteLength,
      // Computed from the bytes that were actually stored, not supplied
      // by the client: a checksum a caller asserts proves nothing about
      // what arrived.
      checksumSha256: createHash('sha256').update(content).digest('hex'),
      uploadedBy: user.id,
    });

    await this.audit.record({
      action: 'lab_attachment.upload',
      actor: { userId: user.id, role: user.role },
      entityType: 'lab_order',
      entityId: current.publicId,
      metadata: { attachmentId: attachment.id, kind: input.kind, sizeBytes: content.byteLength },
    });

    const row = await this.context.require(user, publicId);

    return toLabOrderDetailView(row, new Date());
  }

  /**
   * API §8.9 — attach this order's report to a medical record.
   *
   * Every refusal is a 422 with `fieldErrors`, because each one names a
   * field the caller sent and can correct — which is what API §0.3 gives
   * 422 for. A 409 would say "try again later"; none of these gets
   * better with time.
   */
  async attachToRecord(
    user: AuthenticatedUser,
    publicId: string,
    input: AttachToRecordInput,
  ): Promise<AttachToRecordResult> {
    const current = await this.context.require(user, publicId);

    this.assertIdentityMatches(current, input);

    // Nothing released, nothing to file. `no-results` in the frontend's
    // vocabulary.
    if (current.results.length === 0) {
      throw AppException.validation(
        {
          labOrderId: [
            'This order has no released results, so there is no report to attach.',
          ],
        },
        'Nothing to attach',
      );
    }

    const record = await this.attachments.recordByPublicId(input.recordId);

    // A record on **another patient** is the same refusal as a record
    // that does not exist, and deliberately so: confirming that `MR-…`
    // exists but belongs to someone else is a disclosure about a chart
    // the caller has no relationship with (ADR-022's reasoning, applied
    // to records rather than patients).
    if (record === null || record.patientId !== current.patient.id) {
      throw AppException.validation(
        { recordId: ['No such record for this patient.'] },
        'Unknown record',
      );
    }

    const reports = await this.attachments.attachmentsForOrder(current.id);
    if (reports.length === 0) {
      throw AppException.validation(
        {
          labOrderId: [
            'This order carries no report document yet. Upload the report before attaching it ' +
              'to a record.',
          ],
        },
        'No report document',
      );
    }

    // `already-attached`. Refused rather than doubled: two copies of one
    // report on one encounter is a reader wondering which is current.
    const existing = await this.attachments.attachedFileIds(
      record.id,
      reports.map((report) => report.fileId),
    );
    const pending = reports.filter((report) => !existing.has(report.fileId));

    if (pending.length === 0) {
      throw AppException.validation(
        { recordId: ['This report is already attached to that record.'] },
        'Already attached',
      );
    }

    const attachmentIds = await this.attachments.attachToRecord({
      recordId: record.id,
      labOrderPublicId: current.publicId,
      attachments: pending.map((report) => ({
        name: report.name,
        fileId: report.fileId,
        sizeKb: report.sizeKb,
      })),
      actorId: user.id,
      actorName: await this.context.actorName(user),
    });

    await this.audit.record({
      action: 'lab_order.attach_to_record',
      actor: { userId: user.id, role: user.role },
      entityType: 'lab_order',
      entityId: current.publicId,
      // The confirmed identity is recorded because it is the evidence
      // that the check was satisfied — the MRN a clinician confirmed is
      // what a later review of a mis-filed report asks for first. The
      // patient handle rather than the name, so the audit row carries
      // the identifier and not the PHI.
      metadata: {
        recordId: record.publicId,
        patientId: current.patient.publicId,
        confirmedMrn: input.confirmedPatient.mrn,
        attachments: attachmentIds.length,
      },
    });

    return {
      recordId: record.publicId,
      labOrderId: current.publicId,
      attachmentIds,
    };
  }

  /**
   * `confirmedPatient` must name the order's own patient.
   *
   * Name and MRN are compared **independently**, so a right name with a
   * wrong MRN is refused rather than passing on the strength of the
   * half that matched. Comparison is trimmed and case-insensitive on the
   * name — "amira saleh" is the same person as "Amira Saleh" and a
   * clinician typing a confirmation should not be defeated by a capital
   * — and trimmed but case-**sensitive**-insensitive on the MRN too,
   * since MRNs here are digits and hyphens where case cannot differ.
   *
   * The error deliberately does **not** name the correct patient. A
   * mismatch response that echoed "this is actually Khaled Nassar" would
   * turn the identity check into a lookup: send any record id and a
   * guessed name, read the real one out of the 422.
   */
  private assertIdentityMatches(order: DetailRow, input: AttachToRecordInput): void {
    const nameMatches = normalize(input.confirmedPatient.name) === normalize(order.patient.fullName);
    const mrnMatches = normalize(input.confirmedPatient.mrn) === normalize(order.patient.mrn);

    if (nameMatches && mrnMatches) return;

    const fieldErrors: Record<string, string[]> = {};
    if (!nameMatches) {
      fieldErrors['confirmedPatient.name'] = [
        'The confirmed name does not match the patient this result belongs to.',
      ];
    }
    if (!mrnMatches) {
      fieldErrors['confirmedPatient.mrn'] = [
        'The confirmed MRN does not match the patient this result belongs to.',
      ];
    }

    throw AppException.validation(
      fieldErrors,
      'The confirmed identity does not match this result',
      'patient_identity_mismatch',
    );
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Base64 in, bytes out — refusing anything that is not base64.
 *
 * `Buffer.from(value, 'base64')` is famously permissive: it skips
 * characters it does not recognise rather than failing, so a truncated
 * or corrupted upload decodes to *something* and gets stored as a file
 * nobody can open. Re-encoding and comparing is the cheap way to make
 * the decode total: if the round trip does not reproduce the input, the
 * input was not base64.
 */
function decodeBase64(value: string): Buffer {
  const content = Buffer.from(value, 'base64');

  if (content.byteLength === 0 || content.toString('base64') !== value.replace(/\s/g, '')) {
    throw AppException.validation(
      { content: ['The attachment content must be base64-encoded.'] },
      'Malformed attachment',
    );
  }

  return content;
}
