/**
 * The `files` table and the six relations that give a file its subject
 * (DB §11, RM M25).
 *
 * ## Why the link tables are read here
 *
 * API §17.2 scopes download to "owner/scoped". Who else may read a file
 * depends on **what it is attached to** — a lab attachment belongs to an
 * order which belongs to a patient, and the platform's answer to "may
 * this doctor reach that patient" is `PatientScopeService`. M2.2's zone 1
 * forbids importing the labs module to ask it, and its own wording says
 * what to do instead: query it through your own repository. So this
 * repository reads six link tables and returns one subject; the
 * *decision* is `FileAccessService`'s.
 *
 * Each lookup selects the owning id and nothing else. A file scope check
 * must not pull a clinical row into memory to decide whether the caller
 * may see that the file exists.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FileRow {
  readonly id: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: bigint;
  readonly checksumSha256: string;
  readonly kind: string;
  readonly uploadedBy: string | null;
  readonly hospitalId: string | null;
  readonly scannedAt: Date | null;
  readonly scanResult: string | null;
  readonly createdAt: Date;
}

const FILE_SELECT = {
  id: true,
  storageKey: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  kind: true,
  uploadedBy: true,
  // The hospital the file belongs to once linked (F-14): reads are scoped by it.
  hospitalId: true,
  scannedAt: true,
  scanResult: true,
  createdAt: true,
} as const;

/** Where the malware sweep's last batch ended — see `MalwareScanService`. */
export interface ScanCursor {
  readonly createdAt: Date;
  readonly id: string;
}

@Injectable()
export class FileRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(id: string): Promise<FileRow | null> {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.file.findUnique({ where: { id }, select: FILE_SELECT });
  }

  create(input: {
    readonly storageKey: string;
    readonly originalName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly checksumSha256: string;
    readonly kind: string;
    readonly uploadedBy: string;
  }): Promise<FileRow> {
    return this.prisma.db.file.create({
      data: { ...input, sizeBytes: BigInt(input.sizeBytes) },
      select: FILE_SELECT,
    });
  }

  /**
   * API §17.3's soft delete, as a compare-and-set on `deleted_at IS NULL`.
   *
   * Two deletes of one file must not both report success: the second is
   * a 404, and the object is swept once rather than queued twice.
   */
  async softDelete(id: string, at: Date): Promise<boolean> {
    if (!UUID.test(id)) return false;

    const written = await this.prisma.db.file.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: at },
    });

    return written.count === 1;
  }

  /* ── Subjects (API §17.2's "scoped") ─────────────────────────── */

  /** The patient a document belongs to, or `null` if it is not linked. */
  async patientForDocument(fileId: string): Promise<string | null> {
    const row = await this.prisma.db.patientDocument.findFirst({
      where: { fileId },
      select: { patientId: true },
    });

    return row?.patientId ?? null;
  }

  async patientForRecordAttachment(fileId: string): Promise<string | null> {
    const row = await this.prisma.db.recordAttachment.findFirst({
      where: { fileId },
      select: { record: { select: { patientId: true } } },
    });

    return row?.record.patientId ?? null;
  }

  async patientForLabAttachment(fileId: string): Promise<string | null> {
    const row = await this.prisma.db.labAttachment.findFirst({
      where: { fileId },
      select: { order: { select: { patientId: true } } },
    });

    return row?.order.patientId ?? null;
  }

  /** The conversation participants who may see a message attachment. */
  async participantsForMessageAttachment(fileId: string): Promise<readonly string[]> {
    const row = await this.prisma.db.messageAttachment.findFirst({
      where: { fileId },
      select: {
        message: {
          select: { conversation: { select: { participants: { select: { userId: true } } } } },
        },
      },
    });

    return row?.message.conversation.participants.map((participant) => participant.userId) ?? [];
  }

  /** The account whose registration a verification document supports. */
  async userForVerificationDocument(fileId: string): Promise<string | null> {
    const row = await this.prisma.db.doctorVerificationDocument.findFirst({
      where: { fileId },
      select: { doctor: { select: { userId: true } } },
    });

    return row?.doctor.userId ?? null;
  }

  /* ── The malware scan (M25.3's gate, M30.2's sweep) ──────────── */

  /**
   * Files that have never been scanned, oldest first.
   *
   * `scan_result IS NULL` is the selector rather than `scanned_at`,
   * because the column the gate reads is `scan_result` and a row with
   * one set and not the other is the inconsistency M25.3 was written to
   * remove. Oldest first so an upload cannot be starved by newer ones.
   *
   * Read through `db`, not the base client: a soft-deleted file is on
   * its way to the orphan sweep and nobody will ever download it, so
   * scanning it would be work for an object that is about to be removed.
   */
  unscanned(
    limit: number,
    after: ScanCursor | null = null,
  ): Promise<{ id: string; storageKey: string; mimeType: string; createdAt: Date }[]> {
    return this.prisma.db.file.findMany({
      where: {
        scanResult: null,
        storageKey: { not: '' },
        // Keyset on `(created_at, id)`: strictly after the last row the
        // previous run examined, so a run resumes rather than restarts.
        ...(after === null
          ? {}
          : {
              OR: [
                { createdAt: { gt: after.createdAt } },
                { createdAt: after.createdAt, id: { gt: after.id } },
              ],
            }),
      },
      select: { id: true, storageKey: true, mimeType: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  /**
   * Records a verdict, once.
   *
   * Guarded on `scan_result IS NULL` so two instances sweeping at the
   * same time cannot overwrite each other's verdict — and in particular
   * so a later run cannot turn an `infected` row back into `clean`.
   * Returns whether this call was the one that wrote.
   */
  async markScanned(id: string, verdict: string, at: Date): Promise<boolean> {
    const written = await this.prisma.db.file.updateMany({
      where: { id, scanResult: null },
      data: { scanResult: verdict, scannedAt: at },
    });

    return written.count === 1;
  }

  /* ── The orphan sweep (M25.5) ────────────────────────────────── */

  /**
   * Soft-deleted files whose object is still in the store.
   *
   * Read through the **base** client, not `db`: the soft-delete extension
   * hides exactly the rows this query is looking for. `storage_key` is
   * emptied once the object is gone, so a swept row is not offered
   * twice — which is what makes the sweep resumable after a crash
   * halfway through a batch.
   */
  sweepable(limit: number): Promise<{ id: string; storageKey: string }[]> {
    return this.prisma.file.findMany({
      where: { deletedAt: { not: null }, storageKey: { not: '' } },
      select: { id: true, storageKey: true },
      orderBy: { deletedAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Marks the object gone while keeping the row.
   *
   * The row is the record that a file existed and was deleted — a
   * clinical audit needs that long after the bytes are gone, and DB §11
   * gives `files` a `deleted_at` rather than a delete for that reason.
   * Emptying `storage_key` is what distinguishes "soft-deleted, object
   * still there" from "soft-deleted, object collected".
   */
  async markObjectRemoved(id: string): Promise<void> {
    await this.prisma.file.updateMany({ where: { id }, data: { storageKey: '' } });
  }
}
