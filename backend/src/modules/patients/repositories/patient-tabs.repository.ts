/**
 * The per-tab reads and the child CRUD of API §4.5–4.6 (M10.3).
 *
 * Separate from `PatientRepository` deliberately. That file is the
 * patient *aggregate* — identity, the projection the list and the chart
 * header are built from, and the two safety-critical children the header
 * carries. This one is the tabs: six feeds and four write surfaces that
 * share nothing but the `patient_id` they hang off.
 *
 * ## Every query is keyed by an internal patient id the caller cannot supply
 *
 * The `patientId` here is `patients.id`, resolved by the service from
 * the `PT-…` handle **after** `assertCanReach` has run. There is no path
 * from a request parameter to one of these queries that does not pass
 * through that check.
 *
 * ## Hospital-owned children are filtered to the caller's hospital (S3)
 *
 * Since S3 the key is a `ChartScope` — the patient id plus the active
 * hospital and the patient's hospital medical record there, all three from
 * `PatientScopeService.assertCanReach`. Every table here that carries
 * `hospital_id` is read with `hospital_id = <active hospital>`, so another
 * hospital's rows and legacy rows with no hospital (#17) are not part of
 * the chart, and every row created here is stamped with the scope (DR-04).
 * Emergency contacts carry no hospital: they belong to the patient.
 *
 * ## Soft-deleted children are filtered at the top level
 *
 * Unlike `PatientRepository`'s nested allergy selection, everything here
 * is a top-level `findMany` on the child model — so the soft-delete
 * extension does apply, and no explicit `deletedAt` clause is needed.
 * The asymmetry is worth knowing about rather than guessing at; see
 * `shared/database/soft-delete.ts`.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type { DocumentCategory, HistoryEventKind } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HISTORY_SELECT = {
  id: true,
  kind: true,
  title: true,
  occurredOn: true,
  detail: true,
  facility: true,
  recorder: { select: { publicId: true } },
} as const;

const NOTE_SELECT = {
  id: true,
  title: true,
  body: true,
  authoredAt: true,
  signed: true,
  signedAt: true,
  aiAssisted: true,
  author: { select: { publicId: true } },
} as const;

const VITALS_SELECT = {
  id: true,
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
  recorder: { select: { publicId: true } },
} as const;

const CONTACT_SELECT = {
  id: true,
  name: true,
  relationship: true,
  phone: true,
  isPrimary: true,
} as const;

const DOCUMENT_SELECT = {
  id: true,
  name: true,
  category: true,
  sizeKb: true,
  uploadedAt: true,
  uploader: { select: { publicId: true } },
} as const;

const STUDY_SELECT = {
  id: true,
  modality: true,
  categoryLabel: true,
  name: true,
  performedOn: true,
  status: true,
} as const;

export type HistoryRow = Prisma.PatientMedicalHistoryGetPayload<{ select: typeof HISTORY_SELECT }>;
export type NoteRow = Prisma.PatientNoteGetPayload<{ select: typeof NOTE_SELECT }>;
export type VitalsRow = Prisma.PatientVitalSignGetPayload<{ select: typeof VITALS_SELECT }>;
export type ContactRow = Prisma.PatientEmergencyContactGetPayload<{
  select: typeof CONTACT_SELECT;
}>;
export type DocumentRow = Prisma.PatientDocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;
export type StudyRow = Prisma.PatientStudyGetPayload<{ select: typeof STUDY_SELECT }>;

export interface Page<T> {
  readonly rows: readonly T[];
  readonly totalItems: number;
}

/**
 * The upload named in a link request is not one this caller may file:
 * absent, deleted, another account's, or not a `patient_document`. One
 * error for all four — see `linkDocument`.
 */
export class DocumentUploadUnavailable extends Error {
  constructor() {
    super('No linkable upload with this id');
    this.name = 'DocumentUploadUnavailable';
  }
}

/** The upload is already a patient document. A file is filed once. */
export class DocumentUploadAlreadyLinked extends Error {
  constructor() {
    super('The upload is already linked to a patient document');
    this.name = 'DocumentUploadAlreadyLinked';
  }
}

/** What the download route needs, and nothing it does not. */
export interface DocumentDownloadRow {
  readonly file: {
    readonly id: string;
    readonly storageKey: string;
    readonly originalName: string;
    readonly scanResult: string | null;
  };
}

/** The reachable chart, from `PatientScopeService.assertCanReach`. */
export interface ChartScope {
  /** `patients.id` (uuid). */
  readonly patientId: string;
  readonly hospitalId: string;
  readonly hospitalMedicalRecordId: string;
}

/** Read filter: this patient's rows owned by the active hospital only. */
function owned(scope: ChartScope): { patientId: string; hospitalId: string } {
  return { patientId: scope.patientId, hospitalId: scope.hospitalId };
}

/** Write stamp: the patient, the active hospital and its medical record. */
function stamp(scope: ChartScope): ChartScope {
  return {
    patientId: scope.patientId,
    hospitalId: scope.hospitalId,
    hospitalMedicalRecordId: scope.hospitalMedicalRecordId,
  };
}

@Injectable()
export class PatientTabsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async history(scope: ChartScope, page: number, pageSize: number): Promise<Page<HistoryRow>> {
    const where = owned(scope);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.patientMedicalHistory.findMany({
        where,
        select: HISTORY_SELECT,
        orderBy: { occurredOn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.patientMedicalHistory.count({ where }),
    ]);

    return { rows, totalItems };
  }

  createHistory(input: {
    readonly scope: ChartScope;
    readonly actorId: string;
    readonly kind: HistoryEventKind;
    readonly title: string;
    readonly occurredOn: Date;
    readonly detail?: string | null | undefined;
    readonly facility?: string | null | undefined;
  }): Promise<HistoryRow> {
    return this.prisma.db.patientMedicalHistory.create({
      data: {
        ...stamp(input.scope),
        kind: input.kind,
        title: input.title,
        occurredOn: input.occurredOn,
        ...(input.detail === undefined || input.detail === null ? {} : { detail: input.detail }),
        ...(input.facility === undefined || input.facility === null
          ? {}
          : { facility: input.facility }),
        ...(UUID.test(input.actorId)
          ? { recordedBy: input.actorId, createdBy: input.actorId }
          : {}),
      },
      select: HISTORY_SELECT,
    });
  }

  async removeHistory(
    scope: ChartScope,
    eventId: string,
    actorId: string,
    reason: string,
  ): Promise<number> {
    if (!UUID.test(eventId)) return 0;

    const result = await this.prisma.db.patientMedicalHistory.updateMany({
      where: { id: eventId, ...owned(scope) },
      data: {
        deletedAt: new Date(),
        removalReason: reason,
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
    });

    return result.count;
  }

  contacts(patientId: string): Promise<readonly ContactRow[]> {
    return this.prisma.db.patientEmergencyContact.findMany({
      where: { patientId },
      select: CONTACT_SELECT,
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Adds a contact, demoting any existing primary in the same
   * transaction when this one claims the slot.
   *
   * The schema has a partial unique index on "one primary per patient",
   * so the alternative is an insert that fails — and "you already have a
   * primary contact" is not a problem a user should have to resolve by
   * hand when they have just said which one they mean.
   */
  async createContact(input: {
    readonly patientId: string;
    readonly actorId: string;
    readonly name: string;
    readonly relationship: string;
    readonly phone: string;
    readonly isPrimary: boolean;
  }): Promise<ContactRow> {
    return this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.patientEmergencyContact.updateMany({
          where: { patientId: input.patientId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return tx.patientEmergencyContact.create({
        data: {
          patientId: input.patientId,
          name: input.name,
          relationship: input.relationship,
          phone: input.phone,
          isPrimary: input.isPrimary,
          ...(UUID.test(input.actorId)
            ? { createdBy: input.actorId, updatedBy: input.actorId }
            : {}),
        },
        select: CONTACT_SELECT,
      });
    });
  }

  async updateContact(
    patientId: string,
    contactId: string,
    actorId: string,
    data: {
      readonly name?: string | undefined;
      readonly relationship?: string | undefined;
      readonly phone?: string | undefined;
      readonly isPrimary?: boolean | undefined;
    },
  ): Promise<ContactRow | null> {
    if (!UUID.test(contactId)) return null;

    return this.prisma.$transaction(async (tx) => {
      if (data.isPrimary === true) {
        await tx.patientEmergencyContact.updateMany({
          where: { patientId, isPrimary: true, id: { not: contactId } },
          data: { isPrimary: false },
        });
      }

      const moved = await tx.patientEmergencyContact.updateMany({
        where: { id: contactId, patientId },
        data: {
          ...(data.name === undefined ? {} : { name: data.name }),
          ...(data.relationship === undefined ? {} : { relationship: data.relationship }),
          ...(data.phone === undefined ? {} : { phone: data.phone }),
          ...(data.isPrimary === undefined ? {} : { isPrimary: data.isPrimary }),
          ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
        },
      });

      if (moved.count === 0) return null;

      return tx.patientEmergencyContact.findUniqueOrThrow({
        where: { id: contactId },
        select: CONTACT_SELECT,
      });
    });
  }

  async removeContact(
    patientId: string,
    contactId: string,
    actorId: string,
    reason: string | undefined,
  ): Promise<number> {
    if (!UUID.test(contactId)) return 0;

    const result = await this.prisma.db.patientEmergencyContact.updateMany({
      where: { id: contactId, patientId },
      data: {
        deletedAt: new Date(),
        removalReason: reason ?? null,
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
    });

    return result.count;
  }

  async notes(scope: ChartScope, page: number, pageSize: number): Promise<Page<NoteRow>> {
    const where = owned(scope);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.patientNote.findMany({
        where,
        select: NOTE_SELECT,
        orderBy: { authoredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.patientNote.count({ where }),
    ]);

    return { rows, totalItems };
  }

  createNote(input: {
    readonly scope: ChartScope;
    readonly authorId: string;
    readonly title: string;
    readonly body: string;
    readonly aiAssisted: boolean;
  }): Promise<NoteRow> {
    return this.prisma.db.patientNote.create({
      data: {
        ...stamp(input.scope),
        // NOT NULL with RESTRICT on the author: an unattributable
        // clinical note is not a note.
        authorId: input.authorId,
        title: input.title,
        body: input.body,
        aiAssisted: input.aiAssisted,
        createdBy: input.authorId,
        updatedBy: input.authorId,
      },
      select: NOTE_SELECT,
    });
  }

  /** Author and state, for explaining why an edit or a signature moved no row. */
  noteState(
    scope: ChartScope,
    noteId: string,
  ): Promise<{ authorId: string; signed: boolean } | null> {
    if (!UUID.test(noteId)) return Promise.resolve(null);

    return this.prisma.db.patientNote.findFirst({
      where: { id: noteId, ...owned(scope) },
      select: { authorId: true, signed: true },
    });
  }

  /**
   * Edits an **unsigned** note **the caller wrote**. Both are in the
   * predicate, not checked beforehand: a signature landing between the
   * check and the write would otherwise let an edit through after the
   * attestation, and authorship is the authorization (BR-DEC-001), so it
   * belongs in the same statement as the write it authorizes.
   */
  async updateUnsignedNote(
    scope: ChartScope,
    noteId: string,
    actorId: string,
    data: { readonly title?: string | undefined; readonly body?: string | undefined },
  ): Promise<NoteRow | null> {
    if (!UUID.test(noteId)) return null;

    const moved = await this.prisma.db.patientNote.updateMany({
      where: { id: noteId, ...owned(scope), authorId: actorId, signed: false },
      data: {
        ...(data.title === undefined ? {} : { title: data.title }),
        ...(data.body === undefined ? {} : { body: data.body }),
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
    });

    if (moved.count === 0) return null;

    return this.prisma.db.patientNote.findUniqueOrThrow({
      where: { id: noteId },
      select: NOTE_SELECT,
    });
  }

  /**
   * Signs a note **the caller wrote**. `signed: false` in the predicate
   * makes the operation idempotent-safe: a second signature moves no row
   * and cannot overwrite the first one's timestamp. `authorId` in it is
   * BR-DEC-001 — a signature is the author's attestation.
   */
  async signNote(scope: ChartScope, noteId: string, actorId: string): Promise<NoteRow | null> {
    if (!UUID.test(noteId)) return null;

    const moved = await this.prisma.db.patientNote.updateMany({
      where: { id: noteId, ...owned(scope), authorId: actorId, signed: false },
      data: {
        signed: true,
        signedAt: new Date(),
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
    });

    if (moved.count === 0) return null;

    return this.prisma.db.patientNote.findUniqueOrThrow({
      where: { id: noteId },
      select: NOTE_SELECT,
    });
  }

  async vitals(scope: ChartScope, page: number, pageSize: number): Promise<Page<VitalsRow>> {
    const where = owned(scope);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.patientVitalSign.findMany({
        where,
        select: VITALS_SELECT,
        orderBy: { recordedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.patientVitalSign.count({ where }),
    ]);

    return { rows, totalItems };
  }

  createVitals(input: {
    readonly scope: ChartScope;
    readonly actorId: string;
    readonly recordedAt?: Date | undefined;
    readonly systolic: number;
    readonly diastolic: number;
    readonly heartRate: number;
    readonly temperatureC: number;
    readonly respiratoryRate: number;
    readonly oxygenSaturation: number;
    readonly weightKg: number;
    readonly heightCm: number;
  }): Promise<VitalsRow> {
    return this.prisma.db.patientVitalSign.create({
      data: {
        ...stamp(input.scope),
        ...(input.recordedAt === undefined ? {} : { recordedAt: input.recordedAt }),
        bloodPressureSystolic: input.systolic,
        bloodPressureDiastolic: input.diastolic,
        heartRateBpm: input.heartRate,
        temperatureC: input.temperatureC,
        respiratoryRate: input.respiratoryRate,
        oxygenSaturation: input.oxygenSaturation,
        weightKg: input.weightKg,
        heightCm: input.heightCm,
        // `bmi` is deliberately absent — it is a stored generated column
        // Postgres computes from weight and height, and a value supplied
        // here could disagree with its own inputs.
        ...(UUID.test(input.actorId)
          ? { recordedBy: input.actorId, createdBy: input.actorId }
          : {}),
      },
      select: VITALS_SELECT,
    });
  }

  async medications(scope: ChartScope, page: number, pageSize: number) {
    const where = owned(scope);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.patientMedication.findMany({
        where,
        select: {
          id: true,
          name: true,
          dosage: true,
          frequency: true,
          status: true,
          startDate: true,
          endDate: true,
          // RM M13.6 — which entries came from a prescription and which
          // the patient reported. Selected rather than joined: the
          // reference is on the row, and the prescription itself is a
          // different module's document.
          prescription: { select: { publicId: true } },
        },
        orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.patientMedication.count({ where }),
    ]);

    return { rows, totalItems };
  }

  async documents(scope: ChartScope, page: number, pageSize: number): Promise<Page<DocumentRow>> {
    const where = owned(scope);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.patientDocument.findMany({
        where,
        select: DOCUMENT_SELECT,
        orderBy: { uploadedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.patientDocument.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * API §4.7 — file an upload under the patient's Documents tab.
   *
   * ## Which uploads are linkable
   *
   * Only the caller's **own**, live `patient_document` upload — the rule
   * `RecordRepository.attachUpload` applies to record attachments, and
   * for the same reasons. All four refusals are one
   * `DocumentUploadUnavailable`, so the answer never says whether some
   * other account holds that id.
   *
   * ## Under the file's lock
   *
   * Two concurrent requests linking one upload would both see it
   * unlinked. The `FOR UPDATE` on `files` serializes them, and the second
   * sees the first's row. Inside the transaction the soft-delete
   * extension does not apply, so `deletedAt` is spelled out.
   */
  linkDocument(input: {
    readonly scope: ChartScope;
    readonly fileId: string;
    readonly uploaderId: string;
    readonly category: DocumentCategory;
  }): Promise<DocumentRow> {
    // A non-UUID actor (a test principal) cannot own a `files` row.
    if (!UUID.test(input.uploaderId) || !UUID.test(input.fileId)) {
      return Promise.reject(new DocumentUploadUnavailable());
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM files WHERE id = ${input.fileId}::uuid FOR UPDATE`;

      const file = await tx.file.findFirst({
        where: {
          id: input.fileId,
          kind: 'patient_document',
          uploadedBy: input.uploaderId,
          deletedAt: null,
          // Emptied by M25.5's sweep once the object is collected.
          storageKey: { not: '' },
          // An upload already owned by another hospital is not this chart's
          // to file (DR-04); one with no owner yet is claimed below.
          OR: [{ hospitalId: null }, { hospitalId: input.scope.hospitalId }],
        },
        select: { originalName: true, sizeBytes: true, hospitalId: true },
      });
      if (file === null) throw new DocumentUploadUnavailable();

      const linked = await tx.patientDocument.findFirst({
        where: { fileId: input.fileId, deletedAt: null },
        select: { id: true },
      });
      if (linked !== null) throw new DocumentUploadAlreadyLinked();

      // `validate_clinical_file_owner` requires the file and the document to
      // share a hospital. An unattached upload may still take its owner.
      if (file.hospitalId === null) {
        await tx.file.update({
          where: { id: input.fileId },
          data: { hospitalId: input.scope.hospitalId },
        });
      }

      return tx.patientDocument.create({
        data: {
          ...stamp(input.scope),
          name: file.originalName.slice(0, 200),
          category: input.category,
          // `toView` on `/files` rounds the same way, so the two surfaces
          // agree on a file's size.
          sizeKb: Math.ceil(Number(file.sizeBytes) / 1024),
          fileId: input.fileId,
          uploadedBy: input.uploaderId,
          createdBy: input.uploaderId,
        },
        select: DOCUMENT_SELECT,
      });
    });
  }

  /**
   * A live document on this patient's chart, with the file the download
   * signs. Keyed by the internal patient id, so a document id from
   * another chart is simply absent.
   */
  documentForDownload(scope: ChartScope, documentId: string): Promise<DocumentDownloadRow | null> {
    if (!UUID.test(documentId)) return Promise.resolve(null);

    return this.prisma.db.patientDocument.findFirst({
      where: { id: documentId, ...owned(scope), file: { deletedAt: null } },
      select: {
        file: { select: { id: true, storageKey: true, originalName: true, scanResult: true } },
      },
    });
  }

  studies(scope: ChartScope): Promise<readonly StudyRow[]> {
    return this.prisma.db.patientStudy.findMany({
      where: owned(scope),
      select: STUDY_SELECT,
      orderBy: [{ categoryLabel: 'asc' }, { performedOn: 'desc' }],
    });
  }

  /**
   * The patient's appointment history — API §4.5's `/appointments` tab.
   *
   * Reading `appointments` from the patients module is a table this
   * module does not own, which ADR-036 records as explicitly permitted:
   * M2.2's zones govern imports between modules, not which tables a
   * repository selects from. The projection is written out here rather
   * than reused from `modules/appointments`, so a column added there
   * cannot appear on a patient's chart by default.
   */
  async appointments(scope: ChartScope, page: number, pageSize: number) {
    const where = owned(scope);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.appointment.findMany({
        where,
        select: {
          publicId: true,
          startsAt: true,
          durationMin: true,
          status: true,
          priority: true,
          reason: true,
          doctor: { select: { id: true, fullName: true, specialty: true } },
          visitType: { select: { name: true } },
        },
        orderBy: { startsAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.appointment.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /** Categories are a free-text label on the row; only used for grouping. */
  static groupStudies(rows: readonly StudyRow[]): Map<string, StudyRow[]> {
    const groups = new Map<string, StudyRow[]>();

    for (const row of rows) {
      const bucket = groups.get(row.categoryLabel);
      if (bucket === undefined) groups.set(row.categoryLabel, [row]);
      else bucket.push(row);
    }

    return groups;
  }
}
