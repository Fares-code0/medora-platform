/**
 * The clinical document (RM M12 — API §6).
 *
 * ## Every path goes through `PatientScopeService`
 *
 * RM M7.2 makes it a standing obligation on M9–M14: "each new clinical
 * route must call `assertCanReach` rather than query a PHI table
 * directly". The list cannot ask per row — that would be one query per
 * record — so its scope is the same care-relationship join in the
 * repository, and the two agree because they read the same table with
 * the same predicate. A record absent from the list is one whose detail
 * answers 404, and the spec asserts that pairing rather than assuming it.
 *
 * ## Out of scope is 404, never 403
 *
 * ADR-022: a 403 confirms the record exists. Walking `MR-10001`,
 * `MR-10002`, … against a 403/404 split would disclose the clinic's
 * caseload volume without opening a single chart.
 *
 * ## The version row is the update's receipt
 *
 * M12.6 requires a before/after diff per update. The diff is computed
 * here, from the row this request read, and written by the same
 * transaction that applies the change — so a history cannot be missing
 * the entry for a change that happened. Two concurrent updates race for
 * the version number and one of them is told to retry; the alternative,
 * two rows sharing number 4, is a history that cannot be read in order.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import {
  appliedFilterNames,
  csvFileName,
  EXPORT_ROW_LIMIT,
  exportTooLarge,
  toCsv,
  type CsvColumn,
  type CsvFile,
} from '../../../common/http/csv-export';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher, MandatoryAuditWriter } from '../../../shared/audit';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import {
  assertScanClean,
  DOWNLOAD_TTL_SECONDS,
  FILE_STORAGE,
  type FileStoragePort,
} from '../../../shared/files';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type {
  AllergySeverity,
  RecordAttachmentKind,
  RecordPriority,
  RecordStatus,
} from '../../../generated/prisma/enums';
import {
  ALLERGY_SEVERITY_FROM_WIRE,
  ATTACHMENT_KIND_FROM_WIRE,
  MEDICATION_STATUS_FROM_WIRE,
  RECORD_PRIORITY_FROM_WIRE,
  RECORD_STATUS_FROM_WIRE,
  recordPriorityToWire,
  recordStatusToWire,
} from '../dto/record-enums';
import type {
  MedicalRecordDetailView,
  MedicalRecordView,
  RecordSummaryView,
  RecordVersionView,
} from '../dto/record.dto';
import type {
  AttachRecordFileInput,
  CreateNoteInput,
  CreateRecordInput,
  RecordExportQuery,
  RecordListQuery,
  RecordStatusInput,
  ReportIssueInput,
  UpdateRecordInput,
} from '../dto/record.schema';
import {
  RecordGone,
  RecordRepository,
  UploadAlreadyAttached,
  UploadUnavailable,
  VersionConflict,
  type DetailRow,
  type RecordChildren,
  type RecordCriteria,
  type Worklist,
} from '../repositories/record.repository';

import { assertEditable, recordStatusMachine } from './record-status.machine';
import { toDetailView, toVersionView, toView } from './record-projection';

export interface PaginatedRecords {
  readonly items: readonly MedicalRecordView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class RecordService {
  constructor(
    /** Mandatory audit of disclosures: a failed write refuses the read (F-02). */
    private readonly disclosures: MandatoryAuditWriter,
    private readonly records: RecordRepository,
    private readonly scope: PatientScopeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /** API §6.1. */
  async list(user: AuthenticatedUser, query: RecordListQuery): Promise<PaginatedRecords> {
    const worklist = await this.requireWorklist(user);

    const { rows, totalItems } = await this.records.list(
      worklist,
      criteriaFor(query, query.page, query.pageSize),
    );

    const now = new Date();

    return {
      items: rows.map((row) => toView(row, now)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /**
   * API §6.10 — the filtered list as a CSV file.
   *
   * The list's repository call with the list's criteria, so the export
   * carries exactly the records the caller's screen shows — care-scoped
   * by the same join (M12's status note: the list and the single-record
   * paths are proven to agree, and a third query would be a third thing
   * to keep in agreement). Audited once, after the read, with the row
   * count and the filter *names*.
   */
  async export(user: AuthenticatedUser, query: RecordExportQuery): Promise<CsvFile> {
    const worklist = await this.requireWorklist(user);

    const { rows, totalItems } = await this.records.list(
      worklist,
      criteriaFor(query, 1, EXPORT_ROW_LIMIT),
    );

    if (totalItems > EXPORT_ROW_LIMIT) throw exportTooLarge(totalItems);

    const now = new Date();
    const body = toCsv(LIST_EXPORT_COLUMNS, rows.map((row) => toView(row, now)));

    await this.disclosures.record({
      action: 'medical_record.export',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'medical_record',
      entityId: 'export',
      metadata: { rowCount: rows.length, filters: appliedFilterNames(query), sort: query.sort },
    });

    return { fileName: csvFileName('medical-records', now), body, rowCount: rows.length };
  }

  /**
   * API §6.10 — one record as a `Field,Value` file.
   *
   * The two columns and the row order are the frontend's own
   * `recordSummaryDataset` (`features/doctor/medical-records/model/
   * record-export.ts`), so the file the server produces is the file the
   * quick action already prints — extended with the clinical sections
   * that dataset leaves out (history, examination, vitals, allergies,
   * signed notes).
   *
   * **Care-scoped first**, through the same `require` every single-record
   * path uses: a record outside the caller's care is the 404 a missing
   * one produces, never a file. **Signed notes only**: an unsigned note
   * is a draft its author has not attested, and an export is a document
   * that leaves the system — a draft in it would read as the record.
   * Audited as `medical_record.export` against the record's reference.
   */
  async exportOne(user: AuthenticatedUser, publicId: string): Promise<CsvFile> {
    const row = await this.require(user, publicId);
    const now = new Date();
    const record = toDetailView(row, now);

    const body = toCsv(FIELD_VALUE_COLUMNS, recordFields(record));

    await this.disclosures.record({
      action: 'medical_record.export',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'medical_record',
      entityId: record.id,
      metadata: { rowCount: 1 },
    });

    return {
      fileName: csvFileName(`medical-record-${record.id.toLowerCase()}`, now),
      body,
      rowCount: 1,
    };
  }

  /** API §6.2 — the full document. */
  async detail(user: AuthenticatedUser, publicId: string): Promise<MedicalRecordDetailView> {
    const row = await this.require(user, publicId);

    await this.recordPhiRead(user, row.publicId, 'medical_record.view');

    return toDetailView(row, new Date());
  }

  /**
   * API §6.3 — create a draft.
   *
   * `draft`, always. A record begins as a working document and becomes
   * `active` through §6.5 — creating one straight into `active` would
   * skip the state the action queue counts and would make "draft" a
   * status nothing could ever be in.
   */
  async create(user: AuthenticatedUser, input: CreateRecordInput): Promise<MedicalRecordView> {
    const doctorId = await this.requireDoctor(user);

    await this.scope.assertCanReach(principalOf(user), input.patientId);

    const patient = await this.records.patientByPublicId(input.patientId);
    if (patient === null) throw AppException.notFound('Patient not found');

    const departmentId =
      input.department === undefined ? null : await this.resolveDepartment(input.department);

    const appointmentId =
      input.appointmentId === undefined
        ? null
        : ((await this.records.appointmentForDoctor(doctorId, patient.id, input.appointmentId))
            ?.id ?? null);

    // A named appointment that does not resolve is a client error worth
    // reporting, not a field to drop silently — the record would then
    // claim no visit produced it.
    if (input.appointmentId !== undefined && appointmentId === null) {
      throw AppException.validation(
        { appointmentId: ['No such appointment with this patient in your book'] },
        'The appointment could not be linked',
      );
    }

    const children = await this.resolveChildren(input);
    const actorName = await this.actorName(user);
    const reference = await this.records.nextReference();

    await this.records.create({
      publicId: reference,
      patientId: patient.id,
      doctorId,
      departmentId,
      appointmentId,
      visitDate: input.visitDate,
      visitType: input.visitType,
      priority: RECORD_PRIORITY_FROM_WIRE[input.priority] ?? 'NORMAL',
      chiefComplaint: input.chiefComplaint,
      historyOfPresentIllness: input.historyOfPresentIllness,
      physicalExamination: input.physicalExamination,
      followUpDate: input.followUpDate ?? null,
      children,
      actorId: user.id,
      actorName,
    });

    // Read back by the reference this request allocated, through the
    // same care-scoped path every other read uses. Asking for "the
    // newest record" instead would return a colleague's under
    // concurrency, which is a disclosure rather than an off-by-one.
    const created = await this.require(user, reference);

    await this.afterWrite(user, created.publicId, {
      action: 'medical_record.create',
      topic: 'medical_record.created',
      summary: 'Created a medical record',
      metadata: { status: 'draft' },
    });

    return toView(created, new Date());
  }

  /**
   * API §6.4 — update fields and children.
   *
   * Refused on a `completed` or `archived` record with 409 rather than
   * 403: the caller is permitted, the document is finalised. The
   * correction path is an amendment a reviewer can see, not a silent
   * edit to a signed-off chart.
   *
   * Checked twice, and only the second is authoritative. The first, on
   * the row read here, refuses an obviously finalised record before any
   * ICD lookup — so the error a caller sees for a completed record does
   * not depend on whether their diagnoses resolve. The second runs inside
   * the write's transaction against the row locked there, because a
   * record can be completed between this read and that write.
   */
  async update(
    user: AuthenticatedUser,
    publicId: string,
    input: UpdateRecordInput,
  ): Promise<MedicalRecordDetailView> {
    const current = await this.require(user, publicId);

    // BR-DEC-004 (DEC-004): the record's author edits it. A colleague on
    // the care team may read the record and add a note under their own
    // name, but rewriting the document puts words under the author's.
    // 403 and not 404 — they have just read it. DEC-004 leaves "which
    // roles besides the author" open, so none are admitted until it is
    // decided.
    if (current.doctor.id !== (await this.requireDoctor(user))) {
      throw AppException.forbidden('Only the record’s author may edit it', 'not_record_author');
    }

    assertEditable(current.status);

    const children = await this.resolveChildren(input);
    const changes = diffOf(current, input);

    if (Object.keys(changes).length === 0) {
      // Nothing actually differs from the stored document. Writing a
      // version row saying so would fill the history with entries a
      // clinician cannot act on.
      throw AppException.conflict(
        'The record already holds these values',
        'no_effective_change',
      );
    }

    try {
      await this.records.update({
        recordId: current.id,
        scalars: scalarsOf(input),
        children,
        changes,
        summary: summaryOf(changes),
        reason: input.reason,
        actorId: user.id,
        actorName: await this.actorName(user),
        guard: assertEditable,
      });
    } catch (error) {
      if (error instanceof VersionConflict) {
        throw AppException.conflict(
          'The record changed while this update was in flight; reload and try again',
          'stale_write',
        );
      }

      if (error instanceof RecordGone) throw recordNotFound();

      throw error;
    }

    await this.afterWrite(user, current.publicId, {
      action: 'medical_record.update',
      topic: 'medical_record.updated',
      summary: 'Updated a medical record',
      // Whether a reason was given, not the reason: it is free text typed
      // about a patient's chart and belongs in the chart's history, which
      // `record_versions` is, rather than in the platform ledger.
      metadata: {
        fields: Object.keys(changes).join(','),
        reasonGiven: input.reason !== undefined,
      },
    });

    return toDetailView(await this.require(user, publicId), new Date());
  }

  /** API §6.5 — the guarded lifecycle. */
  async changeStatus(
    user: AuthenticatedUser,
    publicId: string,
    input: RecordStatusInput,
  ): Promise<MedicalRecordDetailView> {
    const current = await this.require(user, publicId);
    const target = RECORD_STATUS_FROM_WIRE[input.status];
    if (target === undefined) throw AppException.notFound('Unknown status');

    recordStatusMachine.assert(current.status, target);

    const moved = await this.records.transitionStatus({
      recordId: current.id,
      from: current.status,
      to: target,
      actorId: user.id,
      actorName: await this.actorName(user),
    });

    if (!moved) throw staleWrite();

    await this.afterWrite(user, current.publicId, {
      action: 'medical_record.status_change',
      topic: 'medical_record.status_changed',
      summary: `Moved a record to ${recordStatusToWire(target)}`,
      metadata: { from: recordStatusToWire(current.status), to: recordStatusToWire(target) },
    });

    return toDetailView(await this.require(user, publicId), new Date());
  }

  /**
   * API §6.6 — add a clinical note.
   *
   * Editability is checked here and again under the row lock, for the
   * reason `update` gives.
   */
  async addNote(
    user: AuthenticatedUser,
    publicId: string,
    input: CreateNoteInput,
  ): Promise<MedicalRecordDetailView> {
    const current = await this.require(user, publicId);

    assertEditable(current.status);

    try {
      await this.records.addNote({
        recordId: current.id,
        authorId: user.id,
        actorName: await this.actorName(user),
        title: input.title,
        body: input.body,
        aiAssisted: input.aiAssisted,
        guard: assertEditable,
      });
    } catch (error) {
      if (error instanceof RecordGone) throw recordNotFound();

      throw error;
    }

    await this.afterWrite(user, current.publicId, {
      action: 'medical_record.note_add',
      topic: 'medical_record.note_added',
      summary: 'Added a clinical note',
      metadata: { aiAssisted: input.aiAssisted },
    });

    return toDetailView(await this.require(user, publicId), new Date());
  }

  /**
   * API §6.6 — sign a note. Signing freezes the content.
   *
   * **Only the author may sign.** A signature is an attestation that the
   * person signing wrote or reviewed the content; a colleague signing
   * someone else's note makes the signature mean nothing, and there is
   * no countersignature concept in the contract to hang it on. 403 here
   * rather than 404, deliberately: the note is not hidden from this
   * caller — they can read it in the document they just fetched — so
   * masking the refusal would only be confusing.
   */
  async signNote(
    user: AuthenticatedUser,
    publicId: string,
    noteId: string,
  ): Promise<MedicalRecordDetailView> {
    const current = await this.require(user, publicId);

    const note = await this.records.noteFor(current.id, noteId);
    if (note === null) throw AppException.notFound('Note not found');

    if (note.authorId !== user.id) {
      throw AppException.forbidden('Only the note’s author may sign it', 'not_note_author');
    }

    if (note.signed) {
      throw AppException.conflict('The note is already signed', 'note_already_signed');
    }

    const signed = await this.records.signNote(current.id, noteId);
    if (!signed) throw AppException.conflict('The note is already signed', 'note_already_signed');

    await this.afterWrite(user, current.publicId, {
      action: 'medical_record.note_sign',
      topic: 'medical_record.note_signed',
      summary: 'Signed a clinical note',
    });

    return toDetailView(await this.require(user, publicId), new Date());
  }

  /**
   * API §6.7 — attach an uploaded file to the record (RM M12.5).
   *
   * The upload went through `POST /files` (kind `record_attachment`),
   * which owns validation, the checksum and the scan queue; this links
   * it. Editability is enforced as it is for a note — checked here and
   * again under the row lock — so a finalised record's attachments are as
   * frozen as its text. A document that arrives after the encounter is
   * closed is filed on an amendment, the same rule M12.3 gives content.
   *
   * An upload this caller may not link is a **422 on `fileId`**, the same
   * answer whether it is absent, deleted, the wrong kind or another
   * account's — anything finer would tell a caller which ids exist.
   */
  async attachFile(
    user: AuthenticatedUser,
    publicId: string,
    input: AttachRecordFileInput,
  ): Promise<MedicalRecordDetailView> {
    const current = await this.require(user, publicId);

    assertEditable(current.status);

    let attachmentId: string;
    try {
      attachmentId = await this.records.attachUpload({
        recordId: current.id,
        fileId: input.fileId,
        uploaderId: user.id,
        kind: ATTACHMENT_KIND_FROM_WIRE[input.kind] as RecordAttachmentKind,
        name: input.name,
        actorName: await this.actorName(user),
        guard: assertEditable,
      });
    } catch (error) {
      if (error instanceof RecordGone) throw recordNotFound();
      if (error instanceof UploadUnavailable) {
        throw AppException.validation(
          {
            fileId: [
              'No upload of yours with this id can be attached. Upload the file to /files ' +
                'with kind record_attachment, then attach the id it returns.',
            ],
          },
          'Unknown upload',
        );
      }
      if (error instanceof UploadAlreadyAttached) {
        throw AppException.conflict(
          'This upload is already attached to a record. Upload the file again to attach a copy.',
          'attachment_already_linked',
        );
      }

      throw error;
    }

    // The attachment id and kind, never the name: a filename is the field
    // most likely to carry a patient's name ("saleh-biopsy.pdf").
    await this.afterWrite(user, current.publicId, {
      action: 'medical_record.attachment_add',
      topic: 'medical_record.attachment_added',
      summary: 'Attached a file to a record',
      metadata: { attachmentId, kind: input.kind },
    });

    return toDetailView(await this.require(user, publicId), new Date());
  }

  /**
   * API §6.7 — a short-lived signed URL for one attachment.
   *
   * Care scope first, then membership, then the scan gate: `403
   * scan_pending` names a real attachment, so it must be unreachable by
   * anyone who cannot reach the record (the rule M25.3 set for `/files`).
   * Audited as `file.download`, the flagged action every other download
   * surface files under, with the record for context.
   */
  async attachmentDownload(
    user: AuthenticatedUser,
    publicId: string,
    attachmentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const current = await this.require(user, publicId);

    const attachment = await this.records.attachmentForDownload(current.id, attachmentId);
    if (attachment === null) throw AppException.notFound('Attachment not found');

    assertScanClean(attachment.file.scanResult, 'attachment');

    const url = await this.storage.signedDownloadUrl(
      attachment.file.storageKey,
      DOWNLOAD_TTL_SECONDS,
      { fileName: attachment.file.originalName, disposition: 'attachment' },
    );

    await this.disclosures.record({
      action: 'file.download',
      actor: { userId: user.id, role: user.role },
      entityType: 'file',
      entityId: attachment.file.id,
      metadata: { kind: 'record_attachment', recordId: current.publicId },
    });

    return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
  }

  /** API §6.8 — the before/after trail. */
  async versions(
    user: AuthenticatedUser,
    publicId: string,
  ): Promise<readonly RecordVersionView[]> {
    const current = await this.require(user, publicId);

    return (await this.records.versions(current.id)).map(toVersionView);
  }

  /** API §6.9 — flag a data error into the admin queue. */
  async reportIssue(
    user: AuthenticatedUser,
    publicId: string,
    input: ReportIssueInput,
  ): Promise<{ id: string; status: string }> {
    const current = await this.require(user, publicId);

    const id = await this.records.reportIssue({
      recordId: current.id,
      reportedBy: user.id,
      description: input.description,
    });

    await this.afterWrite(user, current.publicId, {
      action: 'medical_record.report_issue',
      topic: 'medical_record.issue_reported',
      summary: 'Reported a data issue on a record',
      // The queue item's id, so the administrators' notification (M12.7)
      // and the queue it points at (`GET /admin/record-issues`) name the
      // same row. Never the description: outbox payloads are scalar
      // identifiers, not clinical content.
      payload: { issueId: id },
    });

    return { id, status: 'open' };
  }

  /** API §6.10 — the cards. */
  async summary(user: AuthenticatedUser): Promise<RecordSummaryView> {
    return this.records.summaryFor(await this.requireWorklist(user));
  }

  /** The care-scoped fetch every single-record path begins with. */
  private async require(user: AuthenticatedUser, publicId: string): Promise<DetailRow> {
    const hospitalId = await this.requireHospital(user);
    const row = await this.records.findForDoctor(hospitalId, publicId);
    // Identical to a genuinely missing record, and carrying no
    // reference: the caller must not be able to tell the two apart.
    if (row === null) throw recordNotFound();

    return row;
  }

  /**
   * The doctor's one clinical hospital (F-01): every record read is scoped
   * to it. Without unambiguous clinical standing there is no chart to read,
   * which is the same 404 as a record that does not exist.
   */
  private async requireHospital(user: AuthenticatedUser): Promise<string> {
    await this.requireDoctor(user);
    const hospitalId = await this.scope.clinicalHospitalOf(principalOf(user));
    if (hospitalId === null) throw recordNotFound();
    return hospitalId;
  }

  private async requireWorklist(user: AuthenticatedUser): Promise<Worklist> {
    const [doctorId, hospitalId] = await Promise.all([this.requireDoctor(user), this.requireHospital(user)]);
    return { doctorId, hospitalId };
  }

  private async requireDoctor(user: AuthenticatedUser): Promise<string> {
    const doctorId = await this.records.doctorIdForUser(user.id);
    if (doctorId === null) {
      throw AppException.notFound('No doctor profile for this account');
    }

    return doctorId;
  }

  private async actorName(user: AuthenticatedUser): Promise<string> {
    return (await this.records.displayNameForUser(user.id)) ?? user.publicId;
  }

  private async resolveDepartment(name: string): Promise<string> {
    const id = await this.records.departmentIdByName(name);
    if (id !== null) return id;

    throw AppException.validation(
      { department: ['Unknown department'] },
      'The department is not one this clinic runs',
    );
  }

  /**
   * Child collections, with the ICD codes resolved.
   *
   * An unknown code is a 422 naming the code rather than a dropped
   * diagnosis: a record that silently lost the diagnosis a clinician
   * entered is worse than one that refused to save.
   */
  private async resolveChildren(
    input: CreateRecordInput | UpdateRecordInput,
  ): Promise<RecordChildren> {
    const diagnoses = input.diagnoses;

    if (diagnoses === undefined) return plainChildren(input);

    const codes = diagnoses.map((diagnosis) => diagnosis.code);
    const byCode = await this.records.icdCodeIdsByCode(codes);
    const unknown = codes.filter((code) => byCode[code] === undefined);

    if (unknown.length > 0) {
      throw AppException.validation(
        { diagnoses: [`Unknown ICD-10 code(s): ${unknown.join(', ')}`] },
        'One or more diagnoses could not be coded',
      );
    }

    return {
      ...plainChildren(input),
      diagnoses: diagnoses.map((diagnosis) => ({
        icdCodeId: byCode[diagnosis.code] as string,
        isPrimary: diagnosis.isPrimary,
      })),
    };
  }

  private async recordPhiRead(
    user: AuthenticatedUser,
    reference: string,
    action: string,
  ): Promise<void> {
    await this.disclosures.record({
      action,
      actor: { userId: user.id, role: user.role },
      entityType: 'medical_record',
      entityId: reference,
    });
  }

  private async afterWrite(
    user: AuthenticatedUser,
    reference: string,
    input: {
      readonly action: string;
      readonly topic: string;
      readonly summary: string;
      readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
      readonly payload?: Readonly<Record<string, string>>;
    },
  ): Promise<void> {
    await this.audit.record({
      action: input.action,
      actor: { userId: user.id, role: user.role },
      entityType: 'medical_record',
      entityId: reference,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });

    await this.activity.record({
      userId: user.id,
      kind: 'profile',
      summary: input.summary,
      detail: reference,
    });

    await this.outbox.publish({
      topic: input.topic,
      payload: { ...input.payload, recordId: reference },
      dedupeKey: `${input.topic}:${reference}:${new Date().toISOString()}`,
    });
  }
}

/** One translation of the wire filters, shared by the list and the export. */
function criteriaFor(query: RecordExportQuery, page: number, pageSize: number): RecordCriteria {
  return {
    q: query.q,
    status: query.status?.map((value) => RECORD_STATUS_FROM_WIRE[value] as RecordStatus),
    priority: query.priority?.map((value) => RECORD_PRIORITY_FROM_WIRE[value] as RecordPriority),
    visitType: query.visitType,
    department: query.department,
    diagnosisCode: query.diagnosisCode,
    patientId: query.patientId,
    from: query.from,
    to: query.to,
    sort: query.sort,
    page,
    pageSize,
  };
}

/** The list row, one line per record; the primary diagnosis first. */
const LIST_EXPORT_COLUMNS: readonly CsvColumn<MedicalRecordView>[] = [
  { header: 'recordId', value: (row) => row.id },
  { header: 'visitDate', value: (row) => row.visitDate },
  { header: 'patientId', value: (row) => row.patient.id },
  { header: 'patientName', value: (row) => row.patient.name },
  { header: 'mrn', value: (row) => row.patient.mrn },
  { header: 'visitType', value: (row) => row.visitType },
  { header: 'department', value: (row) => row.department },
  { header: 'doctor', value: (row) => row.doctor },
  { header: 'status', value: (row) => row.status },
  { header: 'priority', value: (row) => row.priority },
  {
    header: 'diagnoses',
    value: (row) => row.diagnoses.map((diagnosis) => `${diagnosis.code} ${diagnosis.label}`).join('; '),
  },
  { header: 'chiefComplaint', value: (row) => row.chiefComplaint },
  { header: 'followUpDate', value: (row) => row.followUpDate },
  { header: 'updatedAt', value: (row) => row.updatedAt },
];

type FieldValue = readonly [field: string, value: string];

const FIELD_VALUE_COLUMNS: readonly CsvColumn<FieldValue>[] = [
  { header: 'Field', value: ([field]) => field },
  { header: 'Value', value: ([, value]) => value },
];

/** `recordSummaryDataset`'s rows, then the clinical sections it leaves out. */
function recordFields(record: MedicalRecordDetailView): FieldValue[] {
  const vitals = record.vitals;

  return [
    ['Record', record.id],
    ['Patient', `${record.patient.name} (${record.patient.mrn})`],
    ['Visit', `${record.visitType} · ${record.department ?? '—'}`],
    ['Visit date', record.visitDate],
    ['Doctor', record.doctor],
    ['Status', record.status],
    ['Priority', record.priority],
    ['Chief complaint', record.chiefComplaint],
    ...record.diagnoses.map(
      (diagnosis, index): FieldValue => [
        `Diagnosis ${String(index + 1)}`,
        `${diagnosis.code} — ${diagnosis.label}${diagnosis.isPrimary ? ' (primary)' : ''}`,
      ],
    ),
    ['History of present illness', record.historyOfPresentIllness],
    ['Physical examination', record.physicalExamination],
    ...(vitals === null
      ? []
      : [
          [
            'Vitals',
            `BP ${vitals.bloodPressure} · HR ${String(vitals.heartRateBpm)} bpm · ` +
              `T ${String(vitals.temperatureC)} °C · RR ${String(vitals.respiratoryRate)} · ` +
              `SpO2 ${String(vitals.oxygenSaturation)}% (${vitals.recordedAt})`,
          ] as FieldValue,
        ]),
    ...record.treatmentPlan.map(
      (step, index): FieldValue => [`Plan ${String(index + 1)}`, step],
    ),
    ...record.medications.map(
      (medication): FieldValue => [
        'Medication',
        `${medication.name} ${medication.dosage} · ${medication.frequency} (${medication.status})`,
      ],
    ),
    ...record.allergies.map(
      (allergy): FieldValue => [
        'Allergy',
        `${allergy.allergen} (${allergy.severity}) — ${allergy.reaction}`,
      ],
    ),
    ...record.notes
      .filter((note) => note.signed)
      .map(
        (note): FieldValue => [
          `Note — ${note.title}`,
          `${note.body} [${note.author}, signed ${note.signedAt ?? note.authoredAt}]`,
        ],
      ),
    ['Follow-up', record.followUpDate ?? '—'],
  ];
}

/** The child collections that need no lookup. */
function plainChildren(input: CreateRecordInput | UpdateRecordInput): RecordChildren {
  return {
    ...(input.treatmentPlan === undefined ? {} : { treatmentPlan: input.treatmentPlan }),
    ...(input.medications === undefined
      ? {}
      : {
          medications: input.medications.map((medication) => ({
            name: medication.name,
            dosage: medication.dosage,
            frequency: medication.frequency,
            instructions: medication.instructions ?? null,
            status: (MEDICATION_STATUS_FROM_WIRE[medication.status] ??
              'ACTIVE'),
          })),
        }),
    ...(input.allergies === undefined
      ? {}
      : {
          allergies: input.allergies.map((allergy) => ({
            allergen: allergy.allergen,
            severity: ALLERGY_SEVERITY_FROM_WIRE[allergy.severity] as AllergySeverity,
            reaction: allergy.reaction,
          })),
        }),
  };
}

/** The scalar columns an update writes, in Prisma's shape. */
function scalarsOf(input: UpdateRecordInput): Record<string, unknown> {
  return {
    ...(input.visitDate === undefined ? {} : { visitDate: input.visitDate }),
    ...(input.visitType === undefined ? {} : { visitType: input.visitType }),
    ...(input.priority === undefined
      ? {}
      : { priority: RECORD_PRIORITY_FROM_WIRE[input.priority] }),
    ...(input.chiefComplaint === undefined ? {} : { chiefComplaint: input.chiefComplaint }),
    ...(input.historyOfPresentIllness === undefined
      ? {}
      : { historyOfPresentIllness: input.historyOfPresentIllness }),
    ...(input.physicalExamination === undefined
      ? {}
      : { physicalExamination: input.physicalExamination }),
    ...(input.followUpDate === undefined ? {} : { followUpDate: input.followUpDate }),
  };
}

/**
 * `{ field: { before, after } }` for the scalars that actually changed,
 * plus a `children` key naming the collections that were replaced.
 *
 * Only genuine differences: a `PATCH` that re-sends a field unchanged is
 * a client echoing its form state, and a version row saying "chief
 * complaint: X → X" is noise in the one place a reviewer needs signal.
 *
 * Child collections are named rather than diffed item by item. The
 * consumers — UX 1.5.3's history and the logs diff viewer — render "the
 * treatment plan was replaced" and link to the document; a per-line diff
 * of ordered free text would be a merge algorithm, which is a different
 * feature nobody has asked for.
 */
function diffOf(
  current: DetailRow,
  input: UpdateRecordInput,
): Readonly<Record<string, unknown>> {
  const changes: Record<string, unknown> = {};

  const scalar = <T>(field: string, before: T, after: T | undefined): void => {
    if (after === undefined) return;
    if (Object.is(before, after)) return;
    changes[field] = { before, after };
  };

  scalar('visitType', current.visitType, input.visitType);
  scalar('chiefComplaint', current.chiefComplaint, input.chiefComplaint);
  scalar(
    'historyOfPresentIllness',
    current.historyOfPresentIllness,
    input.historyOfPresentIllness,
  );
  scalar('physicalExamination', current.physicalExamination, input.physicalExamination);

  if (input.priority !== undefined) {
    const before = recordPriorityToWire(current.priority);
    if (before !== input.priority) changes['priority'] = { before, after: input.priority };
  }

  if (input.visitDate !== undefined) {
    const before = current.visitDate.toISOString();
    const after = input.visitDate.toISOString();
    if (before !== after) changes['visitDate'] = { before, after };
  }

  if (input.followUpDate !== undefined) {
    const before = current.followUpDate?.toISOString().slice(0, 10) ?? null;
    const after = input.followUpDate === null ? null : input.followUpDate.toISOString().slice(0, 10);
    if (before !== after) changes['followUpDate'] = { before, after };
  }

  const replaced = (['diagnoses', 'treatmentPlan', 'medications', 'allergies'] as const).filter(
    (key) => input[key] !== undefined,
  );

  if (replaced.length > 0) changes['children'] = replaced;

  return changes;
}

/** A one-line human summary for the version row. */
function summaryOf(changes: Readonly<Record<string, unknown>>): string {
  const fields = Object.keys(changes);

  return fields.length === 1
    ? `Changed ${String(fields[0])}`
    : `Changed ${String(fields.length)} sections: ${fields.join(', ')}`;
}

/**
 * The one 404 for a record, whether it was never there, is out of scope,
 * or vanished between the read and the write's lock.
 */
function recordNotFound(): AppException {
  return AppException.notFound('Medical record not found');
}

function staleWrite(): AppException {
  return AppException.conflict(
    'The record changed while this request was in flight; reload and try again',
    'stale_write',
  );
}
