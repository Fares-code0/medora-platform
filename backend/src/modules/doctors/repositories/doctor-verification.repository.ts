import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The upload named in a submit request is not one this doctor may file:
 * absent, deleted, collected, another account's, or not a
 * `verification_document`. One error for all five, so the answer is not
 * an oracle for which ids exist.
 */
export class VerificationUploadUnavailable extends Error {
  constructor() {
    super('No fileable upload with this id');
    this.name = 'VerificationUploadUnavailable';
  }
}

/** The upload is already filed as a verification document. A file is filed once. */
export class VerificationUploadAlreadyFiled extends Error {
  constructor() {
    super('The upload is already filed as a verification document');
    this.name = 'VerificationUploadAlreadyFiled';
  }
}

const DOCUMENT_SELECT = {
  id: true,
  kind: true,
  fileId: true,
  uploadedAt: true,
  expiresOn: true,
  decision: true,
  decidedAt: true,
  rejectReason: true,
  checkAuthentic: true,
  checkCurrent: true,
  checkIdentityMatch: true,
} as const;

export interface VerificationDocumentRow {
  readonly id: string;
  readonly kind: string;
  readonly fileId: string;
  readonly uploadedAt: Date;
  readonly expiresOn: Date | null;
  readonly decision: string;
  readonly decidedAt: Date | null;
  readonly rejectReason: string | null;
  readonly checkAuthentic: boolean;
  readonly checkCurrent: boolean;
  readonly checkIdentityMatch: boolean;
}

/**
 * A doctor's own verification documents (NEW-46).
 *
 * The administrator's side — the review, the three checks, the decision —
 * is `AdminDoctorRepository`. This is the half that was missing: nothing
 * created a `doctor_verification_documents` row, so a registered doctor
 * could never reach *Verified*.
 */
@Injectable()
export class DoctorVerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `doctors.id` for this account, or null when it is not a practitioner. */
  async doctorIdForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    // A soft-deleted practitioner is not one (ported from #63): `findUnique`
    // bypasses the soft-delete extension, so the filter is stated.
    const doctor = await this.prisma.db.doctor.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });

    return doctor?.id ?? null;
  }

  /** Every live document of this doctor's, newest first. */
  list(doctorId: string): Promise<readonly VerificationDocumentRow[]> {
    return this.prisma.db.doctorVerificationDocument.findMany({
      where: { doctorId, deletedAt: null },
      select: DOCUMENT_SELECT,
      orderBy: [{ uploadedAt: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * File an upload as a verification document, in one transaction.
   *
   * The `FOR UPDATE` on `files` serializes two concurrent requests filing
   * one upload: without it both would see it unfiled and both would
   * insert. The second waits, then sees the first's row.
   */
  submit(input: {
    readonly doctorId: string;
    readonly uploaderId: string;
    readonly fileId: string;
    readonly kind: string;
    readonly expiresOn: Date | null;
  }): Promise<VerificationDocumentRow> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM files WHERE id = ${input.fileId}::uuid FOR UPDATE`;

      const file = await tx.file.findFirst({
        where: {
          id: input.fileId,
          kind: 'verification_document',
          uploadedBy: input.uploaderId,
          deletedAt: null,
          // Emptied by M25.5's sweep once the object is collected.
          storageKey: { not: '' },
        },
        select: { id: true },
      });
      if (file === null) throw new VerificationUploadUnavailable();

      const filed = await tx.doctorVerificationDocument.findFirst({
        where: { fileId: input.fileId, deletedAt: null },
        select: { id: true },
      });
      if (filed !== null) throw new VerificationUploadAlreadyFiled();

      return tx.doctorVerificationDocument.create({
        data: {
          doctorId: input.doctorId,
          kind: input.kind,
          fileId: input.fileId,
          expiresOn: input.expiresOn,
          createdBy: input.uploaderId,
          updatedBy: input.uploaderId,
        },
        select: DOCUMENT_SELECT,
      });
    });
  }
}
