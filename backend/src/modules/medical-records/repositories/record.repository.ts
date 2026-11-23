/**
 * The clinical document's storage (RM M12 — API §6, DB §D1–D9).
 *
 * ## Care scope is a join, never a check
 *
 * The list is scoped by `patient.careAssignments`, the same predicate
 * `PatientRepository` uses, so a record whose patient the caller is not
 * on is never loaded. Single-record reads go through the service's
 * `PatientScopeService.assertCanReach` as well, and the two agree
 * because they read the same table with the same clause — a record
 * absent from the list is one whose detail answers 404.
 *
 * ## Children are replaced inside the parent's transaction
 *
 * `create` and `update` both write the document and its children in one
 * `$transaction`. A record whose diagnoses landed and whose treatment
 * plan did not is a clinical document that is wrong in a way nobody
 * asked for, and API §6.3 says "transactional" in as many words.
 *
 * ## The version row is written by the same transaction that changes the row
 *
 * M12.6's history is only a history if it cannot be missing an entry.
 * `version` is `MAX(version) + 1` over the record's own rows, taken
 * inside the transaction; `@@unique([recordId, version])` is what turns
 * two concurrent updates into one success and one retryable conflict
 * rather than two rows silently sharing number 4.
 *
 * ## The editability check runs under the row lock it protects
 *
 * A finalised record refuses edits (`assertEditable`), but a check made
 * on a row read before the transaction is a check on a status that may
 * already have changed: §6.4 reads `active`, §6.5 commits `completed`,
 * and the edit then writes to a completed record. `update` and `addNote`
 * therefore lock the record's row first and run the caller's guard
 * against the status read under that lock. `transitionStatus` is an
 * `UPDATE`, which takes the same lock, so the two serialise: whichever
 * commits second sees what the first did.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type {
  AllergySeverity,
  MedicationStatus,
  RecordAttachmentKind,
  RecordPriority,
  RecordStatus,
} from '../../../generated/prisma/enums';
import { CacheService, REFERENCE_DATA, REFERENCE_SCOPE } from '../../../shared/cache';
import { hospitalStampFor, PrismaService } from '../../../shared/database';
import { AppException } from '../../../common/errors/app.exception';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The patient columns API §6.1's snapshot needs, and no more. */
const PATIENT_SELECT = {
  id: true,
  publicId: true,
  fullName: true,
  mrn: true,
  phone: true,
  dateOfBirth: true,
  gender: true,
  bloodType: true,
} satisfies Prisma.PatientSelect;

/**
 * `satisfies` rather than `as const`.
 *
 * `as const` makes every nested array readonly, and Prisma's generated
 * `orderBy` inputs are mutable arrays — a `readonly [{…}, {…}]` is not
 * assignable to them, which is a type error about variance in the middle
 * of a select clause. `satisfies` keeps the literal types Prisma needs
 * to infer the row shape without adding the modifier.
 */
const LIST_SELECT = {
  id: true,
  publicId: true,
  visitDate: true,
  visitType: true,
  status: true,
  priority: true,
  chiefComplaint: true,
  followUpDate: true,
  createdAt: true,
  updatedAt: true,
  patient: { select: PATIENT_SELECT },
  doctor: { select: { id: true, fullName: true } },
  department: { select: { name: true } },
  diagnoses: {
    select: { isPrimary: true, icdCode: { select: { code: true, label: true } } },
    orderBy: [{ isPrimary: 'desc' }, { recordedAt: 'asc' }],
  },
} satisfies Prisma.MedicalRecordSelect;

/** Soft-deletable children need an explicit clause — see `soft-delete.ts`. */
const LIVE = { deletedAt: null };

const DETAIL_SELECT = {
  ...LIST_SELECT,
  historyOfPresentIllness: true,
  physicalExamination: true,
  treatmentPlan: {
    where: LIVE,
    select: { id: true, position: true, text: true },
    orderBy: { position: 'asc' },
  },
  medications: {
    where: LIVE,
    select: {
      id: true,
      name: true,
      dosage: true,
      frequency: true,
      instructions: true,
      status: true,
      // RM M15.2 — the provenance, as the `RX-…` handle rather than the
      // uuid, because no public surface of this API speaks uuids.
      prescription: { select: { publicId: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  allergies: {
    where: LIVE,
    select: { id: true, allergen: true, severity: true, reaction: true },
    orderBy: { createdAt: 'asc' },
  },
  notes: {
    where: LIVE,
    select: {
      id: true,
      title: true,
      body: true,
      signed: true,
      signedAt: true,
      aiAssisted: true,
      authoredAt: true,
      author: { select: { displayName: true } },
    },
    orderBy: { authoredAt: 'desc' },
  },
  attachments: {
    where: LIVE,
    select: {
      id: true,
      name: true,
      kind: true,
      sizeKb: true,
      uploadedAt: true,
      uploader: { select: { displayName: true } },
    },
    orderBy: { uploadedAt: 'desc' },
  },
  timeline: {
    select: { id: true, kind: true, occurredAt: true, actorName: true, detail: true },
    /**
     * Newest first, then `kind`, then `id` — a total order (RA-M14.1).
     *
     * `occurred_at` defaults to `now()`, which in PostgreSQL is the
     * **transaction** timestamp, and creating a record writes `created`
     * and `diagnosis-added` in one transaction. The pair is therefore not
     * at risk of tying: it always ties, and with `occurred_at` as the only
     * key the executor chose which came first.
     *
     * The lab timeline closed the same defect differently, by stamping
     * `received` a millisecond before `processing` (`lab-order.repository.ts`)
     * — receipt genuinely precedes processing. These two events are one act,
     * not two steps, so inventing an interval between them would record a
     * time that never happened; the sort key resolves the tie without
     * changing what was recorded.
     *
     * `RecordTimelineKind` declares `CREATED` first and Postgres sorts a
     * native enum by declaration order, so `desc` puts creation last, where
     * a newest-first reader expects a record's earliest event. `id` is a
     * stability backstop only: two identical reads return one order.
     */
    orderBy: [{ occurredAt: 'desc' }, { kind: 'desc' }, { id: 'desc' }],
  },
  vitalSigns: {
    where: LIVE,
    select: {
      recordedAt: true,
      bloodPressureSystolic: true,
      bloodPressureDiastolic: true,
      heartRateBpm: true,
      temperatureC: true,
      respiratoryRate: true,
      oxygenSaturation: true,
      weightKg: true,
      heightCm: true,
      bmi: true,
    },
    orderBy: { recordedAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.MedicalRecordSelect;

export type ListRow = Prisma.MedicalRecordGetPayload<{ select: typeof LIST_SELECT }>;
export type DetailRow = Prisma.MedicalRecordGetPayload<{ select: typeof DETAIL_SELECT }>;

export interface RecordCriteria {
  readonly q?: string | undefined;
  readonly status?: readonly RecordStatus[] | undefined;
  readonly priority?: readonly RecordPriority[] | undefined;
  readonly visitType?: string | undefined;
  readonly department?: string | undefined;
  readonly diagnosisCode?: string | undefined;
  readonly patientId?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly sort: 'visitDate:asc' | 'visitDate:desc';
  readonly page: number;
  readonly pageSize: number;
}

export interface DiagnosisWrite {
  readonly icdCodeId: string;
  readonly isPrimary: boolean;
}

export interface MedicationWrite {
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  readonly instructions: string | null;
  readonly status: MedicationStatus;
}

export interface AllergyWrite {
  readonly allergen: string;
  readonly severity: AllergySeverity;
  readonly reaction: string;
}

export interface RecordChildren {
  readonly diagnoses?: readonly DiagnosisWrite[] | undefined;
  readonly treatmentPlan?: readonly string[] | undefined;
  readonly medications?: readonly MedicationWrite[] | undefined;
  readonly allergies?: readonly AllergyWrite[] | undefined;
}

/** Raised when two concurrent updates reach for the same version number. */
export class VersionConflict extends Error {
  constructor() {
    super('The record changed while this update was in flight');
    this.name = 'VersionConflict';
  }
}

/** Raised when the row a write is about to lock no longer exists. */
export class RecordGone extends Error {
  constructor() {
    super('The record no longer exists');
    this.name = 'RecordGone';
  }
}

/**
 * The decision a write makes about the status it finds under the lock.
 * It throws to refuse; the transaction then rolls back having written
 * nothing.
 */
export type StatusGuard = (status: RecordStatus) => void;

/**
 * The upload named in an attach request is not one this caller may link:
 * absent, deleted, another account's, or not a `record_attachment`.
 * One error for all four — see `attachUpload`.
 */
export class UploadUnavailable extends Error {
  constructor() {
    super('No linkable upload with this id');
    this.name = 'UploadUnavailable';
  }
}

/** The upload is already on a record. A file is attached once. */
export class UploadAlreadyAttached extends Error {
  constructor() {
    super('The upload is already attached to a record');
    this.name = 'UploadAlreadyAttached';
  }
}

/** What the download route needs, and nothing it does not. */
export interface AttachmentDownloadRow {
  readonly file: {
    readonly id: string;
    readonly storageKey: string;
    readonly originalName: string;
    readonly scanResult: string | null;
  };
}

@Injectable()
export class RecordRepository {
  constructor(
    private readonly prisma: PrismaService,
    /** ICD-10 lookups through the reference-data cache (RM M31.1). */
    private readonly cache: CacheService,
  ) {}

  async doctorIdForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    const doctor = await this.prisma.db.doctor.findUnique({
      where: { userId },
      select: { id: true },
    });

    return doctor?.id ?? null;
  }

  async displayNameForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    const row = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });

    return row?.displayName ?? null;
  }

  /** API §6.1, scoped to the patients the caller has a care relationship with. */
  async list(
    doctorId: string,
    criteria: RecordCriteria,
  ): Promise<{ rows: readonly ListRow[]; totalItems: number }> {
    const where = this.whereFor(doctorId, criteria);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.medicalRecord.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { visitDate: criteria.sort === 'visitDate:asc' ? 'asc' : 'desc' },
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.medicalRecord.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /** The document with every child, care-scoped in the WHERE. */
  findForDoctor(doctorId: string, publicId: string): Promise<DetailRow | null> {
    return this.prisma.db.medicalRecord.findFirst({
      where: { publicId, ...careScope(doctorId) },
      select: DETAIL_SELECT,
    });
  }

  /** The lightweight row, for a status check before a write. */
  findHeaderForDoctor(
    doctorId: string,
    publicId: string,
  ): Promise<{ id: string; publicId: string; status: RecordStatus } | null> {
    return this.prisma.db.medicalRecord.findFirst({
      where: { publicId, ...careScope(doctorId) },
      select: { id: true, publicId: true, status: true },
    });
  }

  async nextReference(): Promise<string> {
    const rows = await this.prisma.$queryRaw<
      Array<{ value: bigint }>
    >`SELECT nextval('medical_record_reference_seq') AS value`;

    return `MR-${String(rows[0]?.value ?? 10_001)}`;
  }

  /** ICD-10 code → id. Active codes only; a retired code is not codable. */
  /**
   * Active ICD-10 codes → their ids, through the reference-data cache
   * (RM M31.1): one `MGET` for the codes a record names, and one query for
   * only the ones that missed. Seed-managed, so the seed's bump is the
   * invalidation. An unknown or inactive code is never cached, so the 422
   * naming it stays live.
   */
  async icdCodeIdsByCode(
    codes: readonly string[],
  ): Promise<Readonly<Record<string, string>>> {
    if (codes.length === 0) return {};

    const found = await this.cache.getMany(
      REFERENCE_DATA,
      REFERENCE_SCOPE,
      codes.map((code) => `icd:${code}`),
      async (keys) => {
        const rows = await this.prisma.db.icdCode.findMany({
          where: { code: { in: keys.map((key) => key.slice('icd:'.length)) }, active: true },
          select: { id: true, code: true },
        });
        return new Map(rows.map((row) => [`icd:${row.code}`, row.id] as const));
      },
    );

    return Object.fromEntries(
      [...found.entries()].map(([key, id]) => [key.slice('icd:'.length), id] as const),
    );
  }

  async departmentIdByName(name: string): Promise<string | null> {
    const row = await this.prisma.db.department.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, status: 'ACTIVE' },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  async patientByPublicId(publicId: string): Promise<{ id: string } | null> {
    return this.prisma.db.patient.findFirst({
      where: { publicId },
      select: { id: true },
    });
  }

  /**
   * The appointment this visit came from, scoped to the same doctor
   * **and the same patient**. Scoping by doctor alone let a record for
   * one patient name the doctor's visit with another, and nothing in the
   * schema ties `medical_records.appointment_id` to the record's patient.
   */
  async appointmentForDoctor(
    doctorId: string,
    patientId: string,
    publicId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.db.appointment.findFirst({
      where: { publicId, doctorId, patientId },
      select: { id: true },
    });
  }

  /** API §6.3 — the document, its children and its `created` event. */
  async create(input: {
    readonly publicId: string;
    readonly patientId: string;
    readonly doctorId: string;
    readonly departmentId: string | null;
    readonly appointmentId: string | null;
    readonly visitDate: Date;
    readonly visitType: string;
    readonly priority: RecordPriority;
    readonly chiefComplaint: string;
    readonly historyOfPresentIllness: string;
    readonly physicalExamination: string;
    readonly followUpDate: Date | null;
    readonly children: RecordChildren;
    readonly actorId: string;
    readonly actorName: string;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      // §2.7: stamped with hospital, record and employment. DR-05 makes the
      // stamp exist whenever the doctor reaches the patient; without one the
      // row would be unattributed, so the write is refused.
      const stamp = await hospitalStampFor(tx, input.doctorId, input.patientId);
      if (stamp === null) throw AppException.notFound('Patient not found');
      const created = await tx.medicalRecord.create({
        data: {
          ...stamp,
          publicId: input.publicId,
          patientId: input.patientId,
          doctorId: input.doctorId,
          departmentId: input.departmentId,
          appointmentId: input.appointmentId,
          visitDate: input.visitDate,
          visitType: input.visitType,
          status: 'DRAFT',
          priority: input.priority,
          chiefComplaint: input.chiefComplaint,
          historyOfPresentIllness: input.historyOfPresentIllness,
          physicalExamination: input.physicalExamination,
          followUpDate: input.followUpDate,
          ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
        },
        select: { id: true },
      });

      await writeChildren(tx, created.id, input.children, input.actorId);

      await tx.recordTimelineEvent.create({
        data: {
          recordId: created.id,
          kind: 'CREATED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
          detail: 'Record created',
        },
      });

      if ((input.children.diagnoses ?? []).length > 0) {
        await tx.recordTimelineEvent.create({
          data: {
            recordId: created.id,
            kind: 'DIAGNOSIS_ADDED',
            ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
            actorName: input.actorName,
            detail: `${String((input.children.diagnoses ?? []).length)} diagnosis/diagnoses recorded`,
          },
        });
      }

      return created.id;
    });
  }

  /**
   * API §6.4 — the scalar changes, the replaced children, the timeline
   * event and the version row, in one transaction.
   *
   * The caller passes the diff it computed from the row it read; this
   * writes it. Computing the diff here would mean reading the row twice
   * — once by the service to decide the write, once here — and the two
   * reads could straddle another update.
   */
  async update(input: {
    readonly recordId: string;
    readonly scalars: Prisma.MedicalRecordUpdateInput;
    readonly children: RecordChildren;
    readonly changes: Readonly<Record<string, unknown>>;
    readonly summary: string;
    /** BR-DEC-004 — absent when the editor gave none. */
    readonly reason?: string | undefined;
    readonly actorId: string;
    readonly actorName: string;
    readonly guard: StatusGuard;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      input.guard(await lockForWrite(tx, input.recordId));

      await tx.medicalRecord.update({
        where: { id: input.recordId },
        data: {
          ...input.scalars,
          ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
        },
      });

      await writeChildren(tx, input.recordId, input.children, input.actorId, true);

      const previous = await tx.recordVersion.findFirst({
        where: { recordId: input.recordId },
        select: { version: true },
        orderBy: { version: 'desc' },
      });

      try {
        await tx.recordVersion.create({
          data: {
            recordId: input.recordId,
            version: (previous?.version ?? 0) + 1,
            ...(UUID.test(input.actorId) ? { changedBy: input.actorId } : {}),
            actorName: input.actorName,
            changes: input.changes as Prisma.InputJsonValue,
            summary: input.summary,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
          },
        });
      } catch (error) {
        // `@@unique([recordId, version])`. Another update took this
        // number between the read above and this insert — the whole
        // transaction rolls back, so the record is untouched and the
        // caller is told to retry rather than being given a history
        // with a gap in it.
        if (isUniqueViolation(error)) throw new VersionConflict();
        throw error;
      }
    });
  }

  /** API §6.5 — compare-and-set the status, with its timeline event. */
  async transitionStatus(input: {
    readonly recordId: string;
    readonly from: RecordStatus;
    readonly to: RecordStatus;
    readonly actorId: string;
    readonly actorName: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.medicalRecord.updateMany({
        where: { id: input.recordId, status: input.from },
        data: {
          status: input.to,
          ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
        },
      });

      if (updated.count === 0) return false;

      await tx.recordTimelineEvent.create({
        data: {
          recordId: input.recordId,
          kind: 'STATUS_CHANGED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
          detail: `${input.from.toLowerCase()} → ${input.to.toLowerCase()}`,
        },
      });

      return true;
    });
  }

  /** API §6.6 — a note plus its timeline event. */
  async addNote(input: {
    readonly recordId: string;
    readonly authorId: string;
    readonly actorName: string;
    readonly title: string;
    readonly body: string;
    readonly aiAssisted: boolean;
    readonly guard: StatusGuard;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      // A note insert takes only a key-share lock on the parent through
      // its foreign key, which a status change does not wait for — the
      // explicit lock is what stops a note landing on a record that was
      // completed after the service read it.
      input.guard(await lockForWrite(tx, input.recordId));

      const note = await tx.recordNote.create({
        data: {
          recordId: input.recordId,
          authorId: input.authorId,
          title: input.title,
          body: input.body,
          aiAssisted: input.aiAssisted,
        },
        select: { id: true },
      });

      await tx.recordTimelineEvent.create({
        data: {
          recordId: input.recordId,
          kind: 'NOTE_ADDED',
          ...(UUID.test(input.authorId) ? { actorId: input.authorId } : {}),
          actorName: input.actorName,
          detail: input.aiAssisted ? `${input.title} (AI-assisted)` : input.title,
        },
      });

      return note.id;
    });
  }

  /**
   * API §6.7 — link an upload to the record (RM M12.5).
   *
   * ## Which uploads are linkable
   *
   * Only the caller's **own**, live `record_attachment` upload. An upload
   * of another kind carries another kind's type and size rules; another
   * account's upload is not this clinician's to file; a deleted one has
   * no future. All four refusals are one `UploadUnavailable`, so the
   * answer never says whether some other account holds that id — the
   * rule `FileAccessService` applies to reads.
   *
   * ## Under two locks
   *
   * The record's, for the reason `addNote` gives: a status change does not
   * wait for a child insert, so the guard is re-run on the locked status.
   * And the file's: two concurrent requests linking one upload would both
   * see it unlinked. The `FOR UPDATE` on `files` serializes them, and the
   * second sees the first's row.
   */
  attachUpload(input: {
    readonly recordId: string;
    readonly fileId: string;
    readonly uploaderId: string;
    readonly kind: RecordAttachmentKind;
    readonly name: string | undefined;
    readonly actorName: string;
    readonly guard: StatusGuard;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      input.guard(await lockForWrite(tx, input.recordId));

      await tx.$queryRaw`SELECT id FROM files WHERE id = ${input.fileId}::uuid FOR UPDATE`;

      const file = await tx.file.findFirst({
        where: {
          id: input.fileId,
          kind: 'record_attachment',
          uploadedBy: input.uploaderId,
          deletedAt: null,
          // Emptied by M25.5's sweep once the object is collected.
          storageKey: { not: '' },
        },
        select: { originalName: true, sizeBytes: true },
      });
      if (file === null) throw new UploadUnavailable();

      const linked = await tx.recordAttachment.findFirst({
        where: { fileId: input.fileId, deletedAt: null },
        select: { id: true },
      });
      if (linked !== null) throw new UploadAlreadyAttached();

      const name = (input.name ?? file.originalName).slice(0, 200);

      const attachment = await tx.recordAttachment.create({
        data: {
          recordId: input.recordId,
          name,
          kind: input.kind,
          // `toView` on `/files` rounds the same way, so the two surfaces
          // agree on a file's size.
          sizeKb: Math.ceil(Number(file.sizeBytes) / 1024),
          fileId: input.fileId,
          uploadedBy: input.uploaderId,
        },
        select: { id: true },
      });

      await tx.recordTimelineEvent.create({
        data: {
          recordId: input.recordId,
          kind: 'ATTACHMENT_ADDED',
          ...(UUID.test(input.uploaderId) ? { actorId: input.uploaderId } : {}),
          actorName: input.actorName,
          detail: name,
        },
      });

      return attachment.id;
    });
  }

  /** A live attachment on this record, with the file the download signs. */
  attachmentForDownload(
    recordId: string,
    attachmentId: string,
  ): Promise<AttachmentDownloadRow | null> {
    if (!UUID.test(attachmentId)) return Promise.resolve(null);

    return this.prisma.db.recordAttachment.findFirst({
      where: { id: attachmentId, recordId, file: { deletedAt: null } },
      select: {
        file: { select: { id: true, storageKey: true, originalName: true, scanResult: true } },
      },
    });
  }

  /** The note as it stands, for the signing guard. */
  noteFor(
    recordId: string,
    noteId: string,
  ): Promise<{ id: string; authorId: string; signed: boolean } | null> {
    if (!UUID.test(noteId)) return Promise.resolve(null);

    return this.prisma.db.recordNote.findFirst({
      where: { id: noteId, recordId },
      select: { id: true, authorId: true, signed: true },
    });
  }

  /**
   * API §6.6 — sign, compare-and-set on `signed: false`.
   *
   * The predicate is what makes signing idempotent in the only direction
   * that matters: a second request finds `count === 0` and is told the
   * note is already signed, rather than quietly moving `signedAt`
   * forward and making the freeze look like it happened later than it
   * did.
   */
  async signNote(recordId: string, noteId: string): Promise<boolean> {
    const updated = await this.prisma.db.recordNote.updateMany({
      where: { id: noteId, recordId, signed: false },
      data: { signed: true, signedAt: new Date() },
    });

    return updated.count > 0;
  }

  /** API §6.8 — the version history, newest first. */
  versions(recordId: string): Promise<
    readonly {
      version: number;
      changedAt: Date;
      actorName: string | null;
      summary: string | null;
      reason: string | null;
      changes: unknown;
    }[]
  > {
    return this.prisma.db.recordVersion.findMany({
      where: { recordId },
      select: {
        version: true,
        changedAt: true,
        actorName: true,
        summary: true,
        reason: true,
        changes: true,
      },
      orderBy: { version: 'desc' },
    });
  }

  /** API §6.9 — flag a data error into the admin queue. */
  async reportIssue(input: {
    readonly recordId: string;
    readonly reportedBy: string;
    readonly description: string;
  }): Promise<string> {
    const created = await this.prisma.db.recordIssueReport.create({
      data: {
        recordId: input.recordId,
        ...(UUID.test(input.reportedBy) ? { reportedBy: input.reportedBy } : {}),
        description: input.description,
      },
      select: { id: true },
    });

    return created.id;
  }

  /** API §6.10 — the cards. */
  async summaryFor(doctorId: string): Promise<{
    open: number;
    completed: number;
    critical: number;
    unsignedNotes: number;
  }> {
    const scope = careScope(doctorId);

    const [open, completed, critical, unsignedNotes] = await Promise.all([
      this.prisma.db.medicalRecord.count({
        where: { ...scope, status: { in: ['DRAFT', 'ACTIVE'] } },
      }),
      this.prisma.db.medicalRecord.count({ where: { ...scope, status: 'COMPLETED' } }),
      this.prisma.db.medicalRecord.count({ where: { ...scope, priority: 'CRITICAL' } }),
      this.prisma.db.recordNote.count({
        where: { signed: false, deletedAt: null, record: scope },
      }),
    ]);

    return { open, completed, critical, unsignedNotes };
  }

  private whereFor(doctorId: string, criteria: RecordCriteria): Prisma.MedicalRecordWhereInput {
    const mode = 'insensitive' as const;

    return {
      ...careScope(doctorId),
      ...(criteria.status === undefined || criteria.status.length === 0
        ? {}
        : { status: { in: [...criteria.status] } }),
      ...(criteria.priority === undefined || criteria.priority.length === 0
        ? {}
        : { priority: { in: [...criteria.priority] } }),
      ...(criteria.visitType === undefined
        ? {}
        : { visitType: { equals: criteria.visitType, mode } }),
      ...(criteria.department === undefined
        ? {}
        : { department: { name: { equals: criteria.department, mode } } }),
      ...(criteria.diagnosisCode === undefined
        ? {}
        : { diagnoses: { some: { icdCode: { code: { equals: criteria.diagnosisCode, mode } } } } }),
      ...(criteria.patientId === undefined
        ? {}
        : { patient: { publicId: criteria.patientId } }),
      ...(criteria.from === undefined && criteria.to === undefined
        ? {}
        : {
            visitDate: {
              ...(criteria.from === undefined ? {} : { gte: criteria.from }),
              ...(criteria.to === undefined ? {} : { lt: criteria.to }),
            },
          }),
      // `q` reaches the patient and the narrative a clinician actually
      // searches by — the handle, the name, the MRN and the chief
      // complaint. Not the HPI or the examination: a substring search
      // over free clinical prose returns everything and helps nobody.
      ...(criteria.q === undefined
        ? {}
        : {
            OR: [
              { publicId: { contains: criteria.q, mode } },
              { chiefComplaint: { contains: criteria.q, mode } },
              { patient: { fullName: { contains: criteria.q, mode } } },
              { patient: { publicId: { contains: criteria.q, mode } } },
              { patient: { mrn: { contains: criteria.q, mode } } },
            ],
          }),
    };
  }
}

/**
 * The care-relationship predicate, in one place.
 *
 * `revokedAt: null` is what makes removing a doctor from a patient's
 * care actually remove their access to that patient's records. It is
 * the same clause `PatientRepository` applies to the chart itself, and
 * the two must agree: a patient absent from a doctor's list is a patient
 * whose records answer 404.
 */
function careScope(doctorId: string): Prisma.MedicalRecordWhereInput {
  return { patient: { careAssignments: { some: { doctorId, revokedAt: null } } } };
}

/**
 * Locks the record's row for the rest of the transaction and returns the
 * status it holds under that lock.
 *
 * `FOR NO KEY UPDATE` rather than `FOR UPDATE`: it is the lock an
 * ordinary `UPDATE` of a non-key column takes, so it conflicts with the
 * status change in `transitionStatus`, which is all the editability rule
 * needs. `FOR UPDATE` would also block every foreign-key insert that
 * references the record — a lab attachment, an Rx-linked medication —
 * for the length of an edit, which is a change to those modules'
 * behaviour this lock has no reason to make.
 *
 * `deleted_at IS NULL` because the raw query bypasses the soft-delete
 * extension, and the service's own read already treats a deleted record
 * as absent.
 */
async function lockForWrite(
  tx: Prisma.TransactionClient,
  recordId: string,
): Promise<RecordStatus> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM medical_records
    WHERE id = ${recordId}::uuid AND deleted_at IS NULL
    FOR NO KEY UPDATE`;

  if (locked.length === 0) throw new RecordGone();

  // Read through the typed client so the status arrives as the Prisma
  // member rather than the database label; no writer can move it now.
  const row = await tx.medicalRecord.findUniqueOrThrow({
    where: { id: recordId },
    select: { status: true },
  });

  return row.status;
}

/**
 * Replaces the child collections the caller named, leaving the rest.
 *
 * `replace` distinguishes creation from update: on create there is
 * nothing to clear, and issuing four `deleteMany`s against a row that
 * cannot have children yet is four statements doing nothing.
 *
 * The children that carry `deletedAt` are **soft**-cleared, because a
 * medication or an allergy that was once on a record is a clinical fact
 * about what the chart said at the time — the same reasoning M10.4
 * records for patient allergies. Diagnoses and treatment-plan lines are
 * hard-replaced: `record_diagnoses` has no `deletedAt` (it is codes, and
 * the version row already says which were removed), and treatment-plan
 * positions are dense and would collide with a tombstone.
 */
async function writeChildren(
  tx: Prisma.TransactionClient,
  recordId: string,
  children: RecordChildren,
  actorId: string,
  replace = false,
): Promise<void> {
  if (children.diagnoses !== undefined) {
    if (replace) await tx.recordDiagnosis.deleteMany({ where: { recordId } });

    for (const diagnosis of children.diagnoses) {
      await tx.recordDiagnosis.create({
        data: {
          recordId,
          icdCodeId: diagnosis.icdCodeId,
          isPrimary: diagnosis.isPrimary,
          ...(UUID.test(actorId) ? { recordedBy: actorId } : {}),
        },
      });
    }
  }

  if (children.treatmentPlan !== undefined) {
    if (replace) await tx.recordTreatmentPlanItem.deleteMany({ where: { recordId } });

    for (const [position, text] of children.treatmentPlan.entries()) {
      await tx.recordTreatmentPlanItem.create({ data: { recordId, position, text } });
    }
  }

  if (children.medications !== undefined) {
    if (replace) {
      // RM M15.2 — `prescriptionId: null` is load-bearing, not a
      // filter for tidiness. A §6.4 edit replaces the medications the
      // author documented in the narrative; it must not reach an entry
      // materialised by signing a prescription against this visit.
      //
      // Without it, a doctor correcting a typo in one medication line
      // would silently drop every Rx-linked row from the chart while
      // `prescriptions.record_id` still pointed back at it — the link
      // would read one way only, and the encounter would under-report
      // what was prescribed at it. An Rx-linked row leaves the chart by
      // discontinuing the prescription (§7.9), which carries a reason
      // and an audit entry; a narrative edit carries neither.
      await tx.recordMedication.updateMany({
        where: { recordId, deletedAt: null, prescriptionId: null },
        data: { deletedAt: new Date() },
      });
    }

    for (const medication of children.medications) {
      await tx.recordMedication.create({
        data: {
          recordId,
          name: medication.name,
          dosage: medication.dosage,
          frequency: medication.frequency,
          instructions: medication.instructions,
          status: medication.status,
        },
      });
    }
  }

  if (children.allergies !== undefined) {
    if (replace) {
      await tx.recordAllergy.updateMany({
        where: { recordId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }

    for (const allergy of children.allergies) {
      await tx.recordAllergy.upsert({
        where: { recordId_allergen: { recordId, allergen: allergy.allergen } },
        create: {
          recordId,
          allergen: allergy.allergen,
          severity: allergy.severity,
          reaction: allergy.reaction,
        },
        // `@@unique([recordId, allergen])` counts soft-deleted rows, so a
        // re-added allergen would hit the constraint rather than
        // inserting. Reviving the row is both correct and what the
        // clinician meant.
        update: { severity: allergy.severity, reaction: allergy.reaction, deletedAt: null },
      });
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
