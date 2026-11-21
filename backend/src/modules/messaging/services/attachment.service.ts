/**
 * Attachment downloads and the scan gate — API §9.10, RM M20.4.
 *
 * > ✅ Verify: gate test.
 *
 * ## The gate is `scanned_at`, and "not yet" is never "clean"
 *
 * UX 2.8 requires that "attachments are scanned before download links
 * activate", and the column's own comment fixes the failure mode: null
 * means *not yet scanned*, which the download path must not read as
 * clean. So the check is an explicit `scannedAt === null` refusal rather
 * than a truthiness test on a nullable timestamp — the two are the same
 * for a scanned file and opposite for an unscanned one, which is exactly
 * the case that matters.
 *
 * The refusal is **403 `scan_pending`**, as §9.10 spells it: the caller
 * may see this attachment and the file exists; what is missing is the
 * scan. A 404 would say the attachment is not there and send a clinician
 * looking for a file they can see in the thread.
 *
 * ## Membership is checked before the gate
 *
 * A non-participant gets **404**, not 403 `scan_pending` — otherwise the
 * gate's own error message would confirm that an attachment with that id
 * exists in a thread they cannot read.
 *
 * ## What is not built here
 *
 * **Uploading.** `POST /conversations/{id}/attachments` needs
 * `FILE_STORAGE.put`, and that port's stub rejects every call with 503
 * until **M25** — deliberately, per ADR-019 §2: "a `put()` that resolved
 * without writing would hand back a file id for bytes that do not
 * exist". Adding a route here would produce a 503 that reads like an
 * outage rather than an unbuilt milestone. **And the scanner itself is
 * M25.3**, which owns the malware scan that would set `scanned_at`;
 * nothing in this module may set it, or the gate would be a door with
 * its own key taped to it.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import {
  assertScanClean,
  DOWNLOAD_TTL_SECONDS,
  FILE_STORAGE,
  type FileStoragePort,
} from '../../../shared/files';
import { MessageRepository } from '../repositories/message.repository';


@Injectable()
export class AttachmentService {
  constructor(
    private readonly messages: MessageRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  async downloadUrl(userId: string, attachmentId: string): Promise<{ url: string }> {
    const attachment = await this.messages.attachment(attachmentId);

    if (attachment === null) throw AppException.notFound('Attachment not found');

    const participants = attachment.message.conversation.participants;

    // Membership first: the gate's refusal names a real attachment, so
    // it must not be reachable by someone who cannot see the thread.
    if (!participants.some((participant) => participant.userId === userId)) {
      throw AppException.notFound('Attachment not found');
    }

    // The gate turns on `files.scan_result`, not on `scanned_at`.
    // DB §11 says why in the column's own comment: null is "not yet
    // scanned, which is not the same as clean". A gate on
    // `scanned_at IS NOT NULL` opens for a file the scanner marked
    // **infected** — a gate that reports success on the one file it
    // exists to stop. Corrected at M25.3; nothing sets `scan_result`
    // until M30.2 runs the scanner, so the refusal is what a caller
    // sees today, which is the correct behaviour of a gate whose
    // scanner has not run.
    assertScanClean(attachment.file.scanResult, 'attachment');

    // `files.storage_key`, not `message_attachments.file_id`. The port
    // takes a storage key; a database id addresses no object, so the
    // presigned URL this used to build pointed at nothing. Invisible
    // while `UnconfiguredFileStorage` rejected every call before the key
    // was used — M25.4's retro-wiring is what surfaced it.
    const url = await this.storage.signedDownloadUrl(
      attachment.file.storageKey,
      DOWNLOAD_TTL_SECONDS,
      { fileName: attachment.file.originalName, disposition: 'attachment' },
    );

    return { url };
  }
}
