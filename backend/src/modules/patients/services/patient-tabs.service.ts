/**
 * The per-tab feeds and the child CRUD (RM M10.3, M10.6 — API §4.5–4.6).
 *
 * ## Every method starts by proving the care relationship
 *
 * `requireReachable` resolves the `PT-…` handle to an internal id
 * **through** `PatientScopeService.assertCanReach`. There is no path
 * from a route parameter to a query in `PatientTabsRepository` that
 * skips it — which is how M7.2's standing obligation ("each new clinical
 * route must call `assertCanReach`") is kept by construction rather than
 * by review.
 *
 * ## Each tab read is its own audit event
 *
 * A clinician who opened a chart's header has not read its notes. API
 * §4.5 calls the tabs a "lazy per-tab fetch", and the reason is PHI
 * rather than payload size: one bundle carrying every tab would make
 * every chart open an access to every clinical note on it, and the audit
 * trail could no longer distinguish "looked at the summary" from "read
 * the psychiatric history".
 *
 * ## A signed note is frozen
 *
 * `signed` is an attestation, and an attestation that can be edited
 * afterwards attests to nothing. The edit and the signature are both
 * `updateMany` with `signed: false` in the **predicate** rather than a
 * read-then-write, so a signature landing between a check and a write
 * cannot let an edit through after the fact. M12.4 carries the same rule
 * for record notes; this is the patient-level half.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PatientScopeService, principalOf, type PatientClinicalScope } from '../../../shared/authz';
import {
  assertScanClean,
  DOWNLOAD_TTL_SECONDS,
  FILE_STORAGE,
  type FileStoragePort,
} from '../../../shared/files';
import {
  appointmentPriorityToWire,
  appointmentStatusToWire,
  DOCUMENT_CATEGORY_FROM_WIRE,
  documentCategoryToWire,
  HISTORY_KIND_FROM_WIRE,
  historyKindToWire,
  medicationStatusToWire,
  studyModalityToWire,
  studyStatusToWire,
} from '../dto/patient-enums';
import type { EmergencyContactView, PatientMedicationView } from '../dto/patient.dto';
import type {
  HistoryEventView,
  PatientDocumentView,
  PatientNoteView,
  PatientStudyView,
  StudyGroupView,
  VitalSignView,
} from '../dto/patient-tabs.dto';
import type {
  CreateEmergencyContactInput,
  CreateHistoryInput,
  CreateNoteInput,
  CreateVitalsInput,
  LinkDocumentInput,
  RemoveContactInput,
  RemoveHistoryInput,
  TabQuery,
  UpdateEmergencyContactInput,
  UpdateNoteInput,
} from '../dto/patient-tabs.schema';
import { PatientRepository } from '../repositories/patient.repository';
import {
  DocumentUploadAlreadyLinked,
  DocumentUploadUnavailable,
  PatientTabsRepository,
  type ContactRow,
  type DocumentRow,
  type HistoryRow,
  type NoteRow,
  type StudyRow,
  type VitalsRow,
} from '../repositories/patient-tabs.repository';

export interface PaginatedTab<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface PatientAppointmentView {
  readonly id: string;
  readonly scheduledAt: string;
  readonly durationMin: number;
  readonly status: string;
  readonly priority: string;
  readonly reason: string;
  readonly visitType: string;
  readonly doctor: { readonly id: string; readonly fullName: string; readonly specialty: string };
}

@Injectable()
export class PatientTabsService {
  constructor(
    private readonly patients: PatientRepository,
    private readonly tabs: PatientTabsRepository,
    private readonly scope: PatientScopeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /** API §4.5 — the five-kind history timeline. */
  async history(
    user: AuthenticatedUser,
    publicId: string,
    query: TabQuery,
  ): Promise<PaginatedTab<HistoryEventView>> {
    const scope = await this.requireReachable(user, publicId, 'history');
    const { rows, totalItems } = await this.tabs.history(scope, query.page, query.pageSize);

    return paginate(rows.map(toHistoryView), query, totalItems);
  }

  async addHistory(
    user: AuthenticatedUser,
    publicId: string,
    input: CreateHistoryInput,
  ): Promise<HistoryEventView> {
    const scope = await this.requireReachable(user, publicId);

    const created = await this.tabs.createHistory({
      scope,
      actorId: user.id,
      kind: HISTORY_KIND_FROM_WIRE[input.kind] ?? 'DIAGNOSIS',
      title: input.title,
      occurredOn: new Date(`${input.occurredOn}T00:00:00Z`),
      detail: input.detail,
      facility: input.facility,
    });

    await this.record(user, publicId, 'patient.history_add', { kind: input.kind });

    return toHistoryView(created);
  }

  async removeHistory(
    user: AuthenticatedUser,
    publicId: string,
    eventId: string,
    input: RemoveHistoryInput,
  ): Promise<void> {
    const scope = await this.requireReachable(user, publicId);

    const removed = await this.tabs.removeHistory(scope, eventId, user.id, input.reason);
    if (removed === 0) throw AppException.notFound('History event not found');

    // That a reason was given, never its text: an audit row names what
    // happened, and the reason is free text about a patient's history.
    // The text is on the removed row, which the soft delete keeps.
    await this.record(user, publicId, 'patient.history_remove', {
      eventId,
      softDeleted: true,
      reasonGiven: true,
    });
  }

  /** API §4.6 — emergency contacts. */
  async contacts(
    user: AuthenticatedUser,
    publicId: string,
  ): Promise<readonly EmergencyContactView[]> {
    const scope = await this.requireReachable(user, publicId, 'contacts');
    return (await this.tabs.contacts(scope.patientId)).map(toContactView);
  }

  async addContact(
    user: AuthenticatedUser,
    publicId: string,
    input: CreateEmergencyContactInput,
  ): Promise<EmergencyContactView> {
    const scope = await this.requireReachable(user, publicId);

    const created = await this.tabs.createContact({
      patientId: scope.patientId,
      actorId: user.id,
      name: input.name,
      relationship: input.relationship,
      phone: input.phone,
      isPrimary: input.isPrimary,
    });

    await this.record(user, publicId, 'patient.contact_add', { isPrimary: input.isPrimary });

    return toContactView(created);
  }

  async updateContact(
    user: AuthenticatedUser,
    publicId: string,
    contactId: string,
    input: UpdateEmergencyContactInput,
  ): Promise<EmergencyContactView> {
    const scope = await this.requireReachable(user, publicId);

    const updated = await this.tabs.updateContact(scope.patientId, contactId, user.id, input);
    if (updated === null) throw AppException.notFound('Contact not found');

    await this.record(user, publicId, 'patient.contact_update', {
      contactId,
      fields: Object.keys(input).sort().join(','),
    });

    return toContactView(updated);
  }

  async removeContact(
    user: AuthenticatedUser,
    publicId: string,
    contactId: string,
    input: RemoveContactInput,
  ): Promise<void> {
    const scope = await this.requireReachable(user, publicId);

    const removed = await this.tabs.removeContact(
      scope.patientId,
      contactId,
      user.id,
      input.reason,
    );
    if (removed === 0) throw AppException.notFound('Contact not found');

    await this.record(user, publicId, 'patient.contact_remove', {
      contactId,
      softDeleted: true,
      reasonGiven: input.reason !== undefined,
    });
  }

  /** API §4.5/§4.6 — clinical notes. */
  async notes(
    user: AuthenticatedUser,
    publicId: string,
    query: TabQuery,
  ): Promise<PaginatedTab<PatientNoteView>> {
    const scope = await this.requireReachable(user, publicId, 'notes');
    const { rows, totalItems } = await this.tabs.notes(scope, query.page, query.pageSize);

    return paginate(rows.map(toNoteView), query, totalItems);
  }

  async addNote(
    user: AuthenticatedUser,
    publicId: string,
    input: CreateNoteInput,
  ): Promise<PatientNoteView> {
    const scope = await this.requireReachable(user, publicId);

    const created = await this.tabs.createNote({
      scope,
      authorId: user.id,
      title: input.title,
      body: input.body,
      aiAssisted: input.aiAssisted,
    });

    await this.record(user, publicId, 'patient.note_add', { aiAssisted: input.aiAssisted });

    return toNoteView(created);
  }

  /**
   * Edits an unsigned note. **Author only** (BR-DEC-001, DEC-001).
   *
   * Reaching the chart is not enough. A colleague who can read a note may
   * not rewrite it: the note is attributed to its author, and an edit by
   * someone else would put words under their name. The author is in the
   * update's predicate, so the refusal cannot race a change of hands.
   *
   * A refusal names its reason — **403 `not_note_author`**, then **409**
   * for a signed note — rather than hiding the note behind a 404. The
   * caller has already proved they may reach this chart and can read the
   * note in the list, so concealing it buys nothing, and the client needs
   * to say which of the two it is. Authorship is checked first: a
   * colleague's signed note is not theirs to edit either way.
   */
  async updateNote(
    user: AuthenticatedUser,
    publicId: string,
    noteId: string,
    input: UpdateNoteInput,
  ): Promise<PatientNoteView> {
    const scope = await this.requireReachable(user, publicId);

    const updated = await this.tabs.updateUnsignedNote(scope, noteId, user.id, input);
    if (updated !== null) {
      await this.record(user, publicId, 'patient.note_update', { noteId });
      return toNoteView(updated);
    }

    const existing = await this.tabs.noteState(scope, noteId);
    if (existing === null) throw AppException.notFound('Note not found');
    if (existing.authorId !== user.id) throw notNoteAuthor('edit');

    throw AppException.conflict('A signed note cannot be edited', 'invalid_status_transition');
  }

  /**
   * API §4.6 — sign a note. The content is frozen from here on.
   *
   * **Author only** (BR-DEC-001), the rule `POST /medical-records/{id}/
   * notes/{noteId}/sign` already applies: a signature is the author's
   * attestation, and one a colleague can apply attests nothing.
   */
  async signNote(
    user: AuthenticatedUser,
    publicId: string,
    noteId: string,
  ): Promise<PatientNoteView> {
    const scope = await this.requireReachable(user, publicId);

    const signed = await this.tabs.signNote(scope, noteId, user.id);
    if (signed !== null) {
      await this.record(user, publicId, 'patient.note_sign', { noteId });
      return toNoteView(signed);
    }

    const existing = await this.tabs.noteState(scope, noteId);
    if (existing === null) throw AppException.notFound('Note not found');
    if (existing.authorId !== user.id) throw notNoteAuthor('sign');

    // Already signed. 409 rather than a silent success: signing twice
    // would otherwise look like it moved the signature's timestamp, and
    // the client should say "already signed" rather than re-render.
    throw AppException.conflict('That note is already signed', 'invalid_status_transition');
  }

  /** API §4.5/§4.6 — vital signs. */
  async vitals(
    user: AuthenticatedUser,
    publicId: string,
    query: TabQuery,
  ): Promise<PaginatedTab<VitalSignView>> {
    const scope = await this.requireReachable(user, publicId, 'vitals');
    const { rows, totalItems } = await this.tabs.vitals(scope, query.page, query.pageSize);

    return paginate(rows.map(toVitalsView), query, totalItems);
  }

  async addVitals(
    user: AuthenticatedUser,
    publicId: string,
    input: CreateVitalsInput,
  ): Promise<VitalSignView> {
    const scope = await this.requireReachable(user, publicId);

    const created = await this.tabs.createVitals({
      scope,
      actorId: user.id,
      recordedAt: input.recordedAt === undefined ? undefined : new Date(input.recordedAt),
      systolic: input.systolic,
      diastolic: input.diastolic,
      heartRate: input.heartRate,
      temperatureC: input.temperatureC,
      respiratoryRate: input.respiratoryRate,
      oxygenSaturation: input.oxygenSaturation,
      weightKg: input.weightKg,
      heightCm: input.heightCm,
    });

    // No values in the metadata: a blood pressure is clinical content,
    // and `AuditMetadata` forbids it. That a reading was taken, by whom
    // and for which patient is the auditable fact.
    await this.record(user, publicId, 'patient.vitals_add', {});

    return toVitalsView(created);
  }

  /** API §4.5 — the medications tab (the full list, not the summary card). */
  async medications(
    user: AuthenticatedUser,
    publicId: string,
    query: TabQuery,
  ): Promise<PaginatedTab<PatientMedicationView>> {
    const scope = await this.requireReachable(user, publicId, 'medications');
    const { rows, totalItems } = await this.tabs.medications(scope, query.page, query.pageSize);

    return paginate(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        dosage: row.dosage,
        frequency: row.frequency,
        status: medicationStatusToWire(row.status),
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
        prescriptionId: row.prescription?.publicId ?? null,
      })),
      query,
      totalItems,
    );
  }

  /**
   * API §4.5 — the documents tab.
   *
   * The metadata only. The **download** is §4.7, `downloadDocument`; a
   * list of documents is not a way to read them, and the route that is
   * answers its own authorization and the scan gate.
   */
  async documents(
    user: AuthenticatedUser,
    publicId: string,
    query: TabQuery,
  ): Promise<PaginatedTab<PatientDocumentView>> {
    const scope = await this.requireReachable(user, publicId, 'documents');
    const { rows, totalItems } = await this.tabs.documents(scope, query.page, query.pageSize);

    return paginate(rows.map(toDocumentView), query, totalItems);
  }

  /**
   * API §4.7 — file an upload under the Documents tab.
   *
   * Care scope first, through `requireReachable`: a doctor outside the
   * care relationship gets the chart's 404 before the upload is looked at,
   * so the link refusal cannot be used to probe file ids against a chart
   * the caller may not see.
   */
  async addDocument(
    user: AuthenticatedUser,
    publicId: string,
    input: LinkDocumentInput,
  ): Promise<PatientDocumentView> {
    const scope = await this.requireReachable(user, publicId);

    let created: DocumentRow;
    try {
      created = await this.tabs.linkDocument({
        scope,
        fileId: input.fileId,
        uploaderId: user.id,
        category: DOCUMENT_CATEGORY_FROM_WIRE[input.category] ?? 'REPORT',
      });
    } catch (error) {
      if (error instanceof DocumentUploadUnavailable) {
        throw AppException.validation(
          {
            fileId: [
              'No upload of yours with this id can be linked. Upload the file to /files ' +
                'with kind patient_document, then link the id it returns.',
            ],
          },
          'Unknown upload',
        );
      }
      if (error instanceof DocumentUploadAlreadyLinked) {
        throw AppException.conflict(
          'This upload is already a patient document. Upload the file again to file a copy.',
          'document_already_linked',
        );
      }

      throw error;
    }

    // The document id and category, never the name: a filename is the
    // field most likely to carry a patient's name.
    await this.record(user, publicId, 'patient.document_add', {
      documentId: created.id,
      category: input.category,
    });

    return toDocumentView(created);
  }

  /**
   * API §4.7 — a signed short-TTL URL for one document, gated on the scan.
   *
   * The order is the one `FilesService.downloadUrl` documents: care scope
   * (`requireReachable`), then the document on **this** chart, and only
   * then the M25.3 gate. A `403 scan_pending` names a real file, so it must
   * be unreachable by anyone who may not see that the file exists —
   * otherwise it is an existence oracle.
   */
  async downloadDocument(
    user: AuthenticatedUser,
    publicId: string,
    documentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const scope = await this.requireReachable(user, publicId);

    const document = await this.tabs.documentForDownload(scope, documentId);
    if (document === null) throw AppException.notFound('Document not found');

    assertScanClean(document.file.scanResult, 'file');

    const url = await this.storage.signedDownloadUrl(
      document.file.storageKey,
      DOWNLOAD_TTL_SECONDS,
      { fileName: document.file.originalName, disposition: 'attachment' },
    );

    await this.audit.record({
      action: 'file.download',
      actor: { userId: user.id, role: user.role },
      entityType: 'file',
      entityId: document.file.id,
      metadata: { kind: 'patient_document', patientId: publicId, documentId },
    });

    return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
  }

  /** API §4.5 — studies, "grouped by category". */
  async studies(user: AuthenticatedUser, publicId: string): Promise<readonly StudyGroupView[]> {
    const scope = await this.requireReachable(user, publicId, 'studies');
    const rows = await this.tabs.studies(scope);

    return [...PatientTabsRepository.groupStudies(rows)].map(([category, studies]) => ({
      category,
      studies: studies.map(toStudyView),
    }));
  }

  /** API §4.5 — the patient's appointment history. */
  async appointments(
    user: AuthenticatedUser,
    publicId: string,
    query: TabQuery,
  ): Promise<PaginatedTab<PatientAppointmentView>> {
    const scope = await this.requireReachable(user, publicId, 'appointments');
    const { rows, totalItems } = await this.tabs.appointments(scope, query.page, query.pageSize);

    return paginate(
      rows.map((row) => ({
        id: row.publicId,
        scheduledAt: row.startsAt.toISOString(),
        durationMin: row.durationMin,
        status: appointmentStatusToWire(row.status),
        priority: appointmentPriorityToWire(row.priority),
        reason: row.reason,
        visitType: row.visitType.name,
        doctor: {
          id: row.doctor.id,
          fullName: row.doctor.fullName,
          specialty: row.doctor.specialty,
        },
      })),
      query,
      totalItems,
    );
  }

  /**
   * The reachable chart's scope — the internal patient id, the active
   * hospital and the patient's medical record there (S3) — or a 404 that
   * does not say which kind.
   *
   * `tab` is recorded on the read audit event when one is written, so
   * the trail distinguishes "opened the chart" from "read the notes" —
   * which is the entire reason these are separate endpoints.
   */
  private async requireReachable(
    user: AuthenticatedUser,
    publicId: string,
    tab?: string,
  ): Promise<PatientClinicalScope> {
    const row = await this.patients.findByPublicId(publicId);
    if (row === null) throw AppException.notFound('Patient not found');

    const scope = await this.scope.assertCanReach(principalOf(user), publicId);

    if (tab !== undefined) await this.record(user, publicId, 'patient.tab_view', { tab });

    return scope;
  }

  private async record(
    user: AuthenticatedUser,
    publicId: string,
    action: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> {
    await this.audit.record({
      action,
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: publicId,
      metadata,
    });
  }
}

function paginate<T>(items: readonly T[], query: TabQuery, totalItems: number): PaginatedTab<T> {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / query.pageSize),
  };
}

function toHistoryView(row: HistoryRow): HistoryEventView {
  return {
    id: row.id,
    kind: historyKindToWire(row.kind),
    title: row.title,
    // A `date` column: the time half is meaningless and a full ISO
    // timestamp would invite a client to apply its own zone to it.
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    detail: row.detail,
    facility: row.facility,
    recordedBy: row.recorder?.publicId ?? null,
  };
}

function toContactView(row: ContactRow): EmergencyContactView {
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    phone: row.phone,
    isPrimary: row.isPrimary,
  };
}

function toNoteView(row: NoteRow): PatientNoteView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    authoredAt: row.authoredAt.toISOString(),
    author: row.author.publicId,
    signed: row.signed,
    signedAt: row.signedAt?.toISOString() ?? null,
    aiAssisted: row.aiAssisted,
  };
}

function toVitalsView(row: VitalsRow): VitalSignView {
  return {
    id: row.id,
    recordedAt: row.recordedAt.toISOString(),
    // Two columns, two fields: `"128/82"` cannot be range-checked and
    // cannot be charted, and both are requirements (DB §14.5-14).
    systolic: row.bloodPressureSystolic,
    diastolic: row.bloodPressureDiastolic,
    heartRate: row.heartRateBpm,
    temperatureC: Number(row.temperatureC),
    respiratoryRate: row.respiratoryRate,
    oxygenSaturation: row.oxygenSaturation,
    weightKg: Number(row.weightKg),
    heightCm: Number(row.heightCm),
    bmi: row.bmi === null ? null : Number(row.bmi),
    recordedBy: row.recorder?.publicId ?? null,
  };
}

function toDocumentView(row: DocumentRow): PatientDocumentView {
  return {
    id: row.id,
    name: row.name,
    category: documentCategoryToWire(row.category),
    sizeKb: row.sizeKb,
    uploadedAt: row.uploadedAt.toISOString(),
    uploadedBy: row.uploader?.publicId ?? null,
  };
}

function toStudyView(row: StudyRow): PatientStudyView {
  return {
    id: row.id,
    modality: studyModalityToWire(row.modality),
    categoryLabel: row.categoryLabel,
    name: row.name,
    performedOn: row.performedOn.toISOString().slice(0, 10),
    status: studyStatusToWire(row.status),
  };
}

/** Same code and status as the medical-record note's signing refusal. */
function notNoteAuthor(verb: 'edit' | 'sign'): AppException {
  return AppException.forbidden(`Only the note’s author may ${verb} it`, 'not_note_author');
}
