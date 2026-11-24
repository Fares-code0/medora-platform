/**
 * Files — API §17, RM M25.1–M25.3.
 *
 * > ✅ Verify (M25.1): wrong MIME for kind → 422; checksum stored.
 * > ✅ Verify (M25.3): pre-scan download blocked.
 *
 * ## The row is written after the object, never before
 *
 * `put()` first, `files` row second. A row written first would describe
 * bytes that may never arrive, and the id would already be in a client's
 * hands. This is the same ordering `lab-attachment.service` established
 * and the reason `UnconfiguredFileStorage` rejected rather than
 * resolving for twenty milestones.
 *
 * The reverse failure — object stored, row not written — leaves an
 * object with no row, which is what **M25.5**'s sweep is for and is the
 * cheap direction to fail in: unreferenced bytes cost storage, a
 * dangling id costs a clinician a broken attachment.
 *
 * ## The checksum is computed here, from the bytes that arrived
 *
 * Never taken from the client. A checksum a caller asserts proves
 * nothing about what was stored; one computed over the received buffer
 * is what makes `files.checksum_sha256` worth having.
 *
 * ## The scan gate turns on `scan_result`, not on `scanned_at`
 *
 * DB §11's own comment says it: "Null means not yet scanned, which is
 * not the same as clean, and the download path must treat it that way".
 * A gate on `scanned_at IS NOT NULL` opens for a file the scanner
 * marked **infected**, which is worse than no gate — it is a gate that
 * reports success on the one file it existed to stop.
 *
 * Nothing sets `scan_result` yet: the scanner runs on the queue, and the
 * queue is **M30.2** ("malware scans (M25.3)"). So every freshly
 * uploaded file is undownloadable, which is the correct behaviour of a
 * gate whose scanner has not run — and is asserted as such rather than
 * worked around.
 */

import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher, MandatoryAuditWriter } from '../../../shared/audit';
import {
  assertScanClean,
  checkSignature,
  checkUpload,
  DOWNLOAD_TTL_SECONDS,
  FILE_STORAGE,
  type FileKind,
  type FileStoragePort,
} from '../../../shared/files';
import { FileRepository, type FileRow } from '../repositories/file.repository';

import { FileAccessService } from './file-access.service';

@Injectable()
export class FilesService {
  constructor(
    /** Mandatory audit of disclosures: a failed write refuses the read (F-02). */
    private readonly disclosures: MandatoryAuditWriter,
    private readonly files: FileRepository,
    private readonly access: FileAccessService,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** API §17.1 — multipart upload. */
  async upload(
    user: AuthenticatedUser,
    kind: FileKind,
    file: { readonly originalname: string; readonly mimetype: string; readonly buffer: Buffer },
  ) {
    // F-09: outside clinical standing, only the documents that restore it.
    if (kind !== 'verification_document' && !(await this.access.inStanding(user))) {
      throw AppException.forbidden('Clinical standing is required for this upload', 'clinical_standing_required');
    }

    // Before storage, so a rejected type is a 422 naming the field
    // rather than a 503 from a store that was never going to be asked.
    // The declared type first, then whether the bytes are that type.
    const violation =
      checkUpload(kind, file.mimetype, file.buffer.byteLength) ??
      checkSignature(file.mimetype, file.buffer);

    if (violation !== null) {
      throw AppException.validation(
        { [violation.field]: [violation.message] },
        'This file cannot be uploaded',
      );
    }

    const stored = await this.storage.put({
      kind,
      name: file.originalname,
      mimeType: file.mimetype,
      content: file.buffer,
    });

    const row = await this.files.create({
      storageKey: stored.key,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.byteLength,
      checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
      kind,
      uploadedBy: user.id,
    });

    await this.audit.record({
      action: 'file.upload',
      actor: { userId: user.id, role: user.role },
      entityType: 'file',
      entityId: row.id,
      // The kind and the size, never the filename: "biopsy-result-ahmed
      // -hassan.pdf" is PHI, and `AuditMetadata` forbids clinical values.
      metadata: { kind, sizeBytes: file.buffer.byteLength, mimeType: file.mimetype },
    });

    return toView(row);
  }

  /**
   * API §17.2 — a signed short-TTL URL, gated on the scan.
   *
   * The scope check runs **first**. The gate's refusal names a real
   * file, so it must be unreachable by someone who may not see that the
   * file exists — otherwise `403 scan_pending` becomes an existence
   * oracle for every id an attacker cares to try.
   */
  async downloadUrl(user: AuthenticatedUser, fileId: string) {
    const file = await this.access.readable(user, fileId);

    assertScanClean(file.scanResult, 'file');

    const url = await this.storage.signedDownloadUrl(file.storageKey, DOWNLOAD_TTL_SECONDS, {
      fileName: file.originalName,
      disposition: 'attachment',
    });

    await this.disclosures.record({
      action: 'file.download',
      actor: { userId: user.id, role: user.role },
      entityType: 'file',
      entityId: file.id,
      metadata: { kind: file.kind },
    });

    return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
  }

  /** API §17.3 — soft delete. The object goes with M25.5's sweep. */
  async remove(user: AuthenticatedUser, fileId: string): Promise<void> {
    const file = await this.access.deletable(user, fileId);

    // A verification document, once filed (`POST /me/verification-
    // documents`), is the reviewer's evidence: deleting it would leave an
    // approved document whose bytes are gone. Unfiled uploads stay
    // deletable — that is how a doctor discards a wrong pick.
    if (
      file.kind === 'verification_document' &&
      (await this.files.userForVerificationDocument(file.id)) !== null
    ) {
      throw AppException.conflict(
        'This file is filed as a verification document and is kept as the reviewer’s evidence.',
        'verification_document_filed',
      );
    }

    // Already deleted is a 404, not a second success: the sweep must see
    // one deletion, and a client must not be told it removed something
    // twice.
    if (!(await this.files.softDelete(file.id, new Date()))) {
      throw AppException.notFound('File not found');
    }

    await this.audit.record({
      action: 'file.delete',
      actor: { userId: user.id, role: user.role },
      entityType: 'file',
      entityId: file.id,
      metadata: { kind: file.kind },
    });
  }

  /** The metadata a client holds between upload and linking. */
  async detail(user: AuthenticatedUser, fileId: string) {
    return toView(await this.access.readable(user, fileId));
  }
}

function toView(row: FileRow) {
  return {
    id: row.id,
    name: row.originalName,
    // The frontend's attachment models carry `sizeKb` (`DocumentsTab`,
    // `RecordAttachmentsSection` both format from it), and API §17.1
    // names it too. Rounded up, so a 1-byte file is not "0 KB".
    sizeKb: Math.ceil(Number(row.sizeBytes) / 1024),
    mimeType: row.mimeType,
    kind: row.kind,
    checksumSha256: row.checksumSha256,
    scanStatus: row.scanResult ?? 'pending',
    uploadedAt: row.createdAt.toISOString(),
  };
}
