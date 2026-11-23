/**
 * Lab attachments and attach-to-record (RM M14.7 — API §8.9, §8.11).
 *
 * ## The `files` row is written after the bytes land, never before
 *
 * `put()` on the `FILE_STORAGE` port resolves with a storage key, and
 * only then is a `files` row created. The reverse order would hand a
 * caller a file id for bytes that do not exist, and the failure would
 * surface later as a broken download rather than as a failed upload —
 * which is exactly the reasoning `UnconfiguredFileStorage` gives for
 * failing loudly instead of resolving quietly.
 *
 * ## Attaching to a record reuses the file, it does not copy it
 *
 * `record_attachments.file_id` points at the **same** `files` row the
 * lab attachment points at. One set of bytes, two references. Copying
 * would double the storage and, worse, create a second object that a
 * later correction to the report would not reach — a record showing a
 * superseded result it believes is current.
 *
 * `record_attachments.kind` is `LAB_RESULT`, which is what RM M15.1's
 * verify step asks to see ("attached report appears in the record's
 * attachments (kind `lab-result`)") and what this milestone puts in
 * place for it.
 */

import { Injectable } from '@nestjs/common';

import type { LabAttachmentKind } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordTarget {
  readonly id: string;
  readonly publicId: string;
  readonly patientId: string;
}

@Injectable()
export class LabAttachmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * §8.11 — register stored bytes against the order.
   *
   * One transaction: the `files` row and the `lab_attachments` row that
   * cites it land together, so a crash between them cannot leave an
   * orphan file nobody can reach or an attachment pointing at nothing.
   *
   * `size_kb` is rounded **up** to at least 1, because
   * `lab_attachments_size_positive` is `> 0` and a 300-byte addendum
   * would otherwise round to zero and be refused. A file is never
   * reported as smaller than it is.
   */
  async attachToOrder(input: {
    readonly labOrderId: string;
    readonly storageKey: string;
    readonly name: string;
    readonly kind: LabAttachmentKind;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly checksumSha256: string;
    readonly uploadedBy: string;
  }): Promise<{ readonly id: string; readonly fileId: string }> {
    const uploader = UUID.test(input.uploadedBy) ? { uploadedBy: input.uploadedBy } : {};

    return this.prisma.$transaction(async (tx) => {
      // The file belongs to the order's hospital (§2.7; a Phase 22 trigger
      // requires a clinical attachment's file to share its parent's hospital).
      const order = await tx.labOrder.findUniqueOrThrow({
        where: { id: input.labOrderId },
        select: { hospitalId: true },
      });
      const file = await tx.file.create({
        data: {
          ...(order.hospitalId === null ? {} : { hospitalId: order.hospitalId }),
          storageKey: input.storageKey,
          originalName: input.name,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          checksumSha256: input.checksumSha256,
          kind: 'lab_attachment',
          ...uploader,
        },
        select: { id: true },
      });

      const attachment = await tx.labAttachment.create({
        data: {
          labOrderId: input.labOrderId,
          name: input.name,
          kind: input.kind,
          sizeKb: Math.max(1, Math.ceil(input.sizeBytes / 1024)),
          fileId: file.id,
          ...uploader,
        },
        select: { id: true },
      });

      return { id: attachment.id, fileId: file.id };
    });
  }

  /** A record by `MR-…`, with the patient it belongs to. */
  async recordByPublicId(publicId: string): Promise<RecordTarget | null> {
    const row = await this.prisma.db.medicalRecord.findFirst({
      where: { publicId, deletedAt: null },
      select: { id: true, publicId: true, patientId: true },
    });

    return row;
  }

  /** Which of this order's reports are already on this record (§8.9). */
  async attachedFileIds(recordId: string, fileIds: readonly string[]): Promise<Set<string>> {
    if (fileIds.length === 0) return new Set();

    const rows = await this.prisma.db.recordAttachment.findMany({
      where: { recordId, fileId: { in: [...fileIds] }, deletedAt: null },
      select: { fileId: true },
    });

    return new Set(rows.map((row) => row.fileId));
  }

  /** The order's attachments, with the files they cite. */
  async attachmentsForOrder(labOrderId: string): Promise<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly fileId: string;
      readonly sizeKb: number;
    }[]
  > {
    return this.prisma.db.labAttachment.findMany({
      where: { labOrderId, deletedAt: null },
      select: { id: true, name: true, fileId: true, sizeKb: true },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  /**
   * §8.9 — file the order's reports onto a record, and say so on the
   * record's own timeline.
   *
   * One transaction, and the timeline event is part of it: an attachment
   * a reader cannot see arriving is a document that appeared in a chart
   * with nobody attached to it. `RecordTimelineKind.ATTACHMENT_ADDED` is
   * the kind M12 already writes for this, so the record's timeline reads
   * the same whether the document came from the labs module or from the
   * record's own upload.
   */
  async attachToRecord(input: {
    readonly recordId: string;
    readonly labOrderPublicId: string;
    readonly attachments: readonly {
      readonly name: string;
      readonly fileId: string;
      readonly sizeKb: number;
    }[];
    readonly actorId: string;
    readonly actorName: string;
  }): Promise<readonly string[]> {
    const uploader = UUID.test(input.actorId) ? { uploadedBy: input.actorId } : {};

    return this.prisma.$transaction(async (tx) => {
      const created: string[] = [];

      for (const attachment of input.attachments) {
        const row = await tx.recordAttachment.create({
          data: {
            recordId: input.recordId,
            name: attachment.name,
            // RM M15.1's verify step: kind `lab-result`.
            kind: 'LAB_RESULT',
            sizeKb: attachment.sizeKb,
            // The same file, not a copy — see the file header.
            fileId: attachment.fileId,
            ...uploader,
          },
          select: { id: true },
        });

        created.push(row.id);
      }

      await tx.recordTimelineEvent.create({
        data: {
          recordId: input.recordId,
          kind: 'ATTACHMENT_ADDED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
          detail: `Lab report ${input.labOrderPublicId} attached`,
        },
      });

      return created;
    });
  }
}
