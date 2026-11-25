import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, PhiRead } from '../../../shared/authz';
import type { EmergencyContactView, PatientMedicationView } from '../dto/patient.dto';
import type {
  HistoryEventView,
  PatientDocumentView,
  PatientNoteView,
  StudyGroupView,
  VitalSignView,
} from '../dto/patient-tabs.dto';
import {
  createEmergencyContactSchema,
  createHistorySchema,
  createNoteSchema,
  createVitalsSchema,
  linkDocumentSchema,
  removeContactSchema,
  removeHistorySchema,
  tabQuerySchema,
  updateEmergencyContactSchema,
  updateNoteSchema,
  type CreateEmergencyContactInput,
  type CreateHistoryInput,
  type CreateNoteInput,
  type CreateVitalsInput,
  type LinkDocumentInput,
  type RemoveContactInput,
  type RemoveHistoryInput,
  type TabQuery,
  type UpdateEmergencyContactInput,
  type UpdateNoteInput,
} from '../dto/patient-tabs.schema';
import {
  PatientTabsService,
  type PaginatedTab,
  type PatientAppointmentView,
} from '../services/patient-tabs.service';

/**
 * The chart's tabs and their child CRUD (RM M10.3, M10.6 — API §4.5–4.6).
 *
 * ## A second controller under one path prefix, on purpose
 *
 * `PatientController` owns the patient *aggregate*: the list, the
 * identity, the header, and the two safety-critical children the header
 * carries. This one owns the tabs. They share the `patients/:patientId`
 * prefix and nothing else, and splitting them keeps each file the size
 * of one screen's contract rather than making one file the whole of API
 * §4.
 *
 * Nest resolves the two without ambiguity because no path is declared
 * twice — the collision that matters is *identical* method-and-path
 * pairs (ADR-036), not a shared prefix.
 *
 * ## The capability is `patients.view`, and the scope check is the real gate
 *
 * Same reasoning as `PatientController`: holding the capability is not a
 * care relationship (reconciliation §5 rule 5). Every method here enters
 * through `assertCanReach`, so an administrator — who holds
 * `patients.view` and no care relationship — is refused each tab with
 * the same 404 a stranger's chart produces.
 */
@Can('patients.view')
@Controller('patients/:patientId')
export class PatientTabsController {
  constructor(private readonly tabs: PatientTabsService) {}

  /** API §4.5 — the five-kind history timeline. */
  @PhiRead('medical_history')
  @Get('history')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Query(zodQuery(tabQuerySchema)) query: TabQuery,
  ): Promise<PaginatedTab<HistoryEventView>> {
    return this.tabs.history(user, patientId, query);
  }

  @Post('history')
  @HttpCode(HttpStatus.CREATED)
  addHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(createHistorySchema)) body: CreateHistoryInput,
  ): Promise<HistoryEventView> {
    return this.tabs.addHistory(user, patientId, body);
  }

  /**
   * Soft removal with a **mandatory** reason in the body (BR-DEC-003).
   * A `DELETE` with a body is unusual and deliberate: the route already
   * existed, and moving removal to a new verb would leave the old one
   * removing history without a reason.
   */
  @Delete('history/:eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('eventId') eventId: string,
    @Body(zodBody(removeHistorySchema)) body: RemoveHistoryInput,
  ): Promise<void> {
    return this.tabs.removeHistory(user, patientId, eventId, body);
  }

  /** API §4.6 — emergency contacts. At most one primary, kept so by the service. */
  @PhiRead('emergency_contacts')
  @Get('emergency-contacts')
  contacts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
  ): Promise<readonly EmergencyContactView[]> {
    return this.tabs.contacts(user, patientId);
  }

  @Post('emergency-contacts')
  @HttpCode(HttpStatus.CREATED)
  addContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(createEmergencyContactSchema)) body: CreateEmergencyContactInput,
  ): Promise<EmergencyContactView> {
    return this.tabs.addContact(user, patientId, body);
  }

  @Patch('emergency-contacts/:contactId')
  updateContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('contactId') contactId: string,
    @Body(zodBody(updateEmergencyContactSchema)) body: UpdateEmergencyContactInput,
  ): Promise<EmergencyContactView> {
    return this.tabs.updateContact(user, patientId, contactId, body);
  }

  /** Soft removal; an optional `reason` in the body is persisted (BR-DEC-003). */
  @Delete('emergency-contacts/:contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('contactId') contactId: string,
    @Body(zodBody(removeContactSchema)) body: RemoveContactInput,
  ): Promise<void> {
    return this.tabs.removeContact(user, patientId, contactId, body);
  }

  /** API §4.5/§4.6 — clinical notes. */
  @PhiRead('patient_notes')
  @Get('notes')
  notes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Query(zodQuery(tabQuerySchema)) query: TabQuery,
  ): Promise<PaginatedTab<PatientNoteView>> {
    return this.tabs.notes(user, patientId, query);
  }

  @Post('notes')
  @HttpCode(HttpStatus.CREATED)
  addNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(createNoteSchema)) body: CreateNoteInput,
  ): Promise<PatientNoteView> {
    return this.tabs.addNote(user, patientId, body);
  }

  /** 409 once the note is signed — an attestation that can be edited attests to nothing. */
  @Patch('notes/:noteId')
  updateNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('noteId') noteId: string,
    @Body(zodBody(updateNoteSchema)) body: UpdateNoteInput,
  ): Promise<PatientNoteView> {
    return this.tabs.updateNote(user, patientId, noteId, body);
  }

  /** API §4.6 — sign. The content is frozen from here on. */
  @Post('notes/:noteId/sign')
  @HttpCode(HttpStatus.OK)
  signNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('noteId') noteId: string,
  ): Promise<PatientNoteView> {
    return this.tabs.signNote(user, patientId, noteId);
  }

  /** API §4.5/§4.6 — vital signs, blood pressure split in two. */
  @PhiRead('vital_signs')
  @Get('vitals')
  vitals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Query(zodQuery(tabQuerySchema)) query: TabQuery,
  ): Promise<PaginatedTab<VitalSignView>> {
    return this.tabs.vitals(user, patientId, query);
  }

  @Post('vitals')
  @HttpCode(HttpStatus.CREATED)
  addVitals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(createVitalsSchema)) body: CreateVitalsInput,
  ): Promise<VitalSignView> {
    return this.tabs.addVitals(user, patientId, body);
  }

  /** API §4.5 — the full medication list, not the summary card's ten. */
  @PhiRead('patient_medications')
  @Get('medications')
  medications(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Query(zodQuery(tabQuerySchema)) query: TabQuery,
  ): Promise<PaginatedTab<PatientMedicationView>> {
    return this.tabs.medications(user, patientId, query);
  }

  /**
   * API §4.5 — document metadata.
   *
   * A list of documents is not a way to read them: the download is its
   * own route below, with its own scope check and the scan gate.
   */
  @PhiRead('patient_documents')
  @Get('documents')
  documents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Query(zodQuery(tabQuerySchema)) query: TabQuery,
  ): Promise<PaginatedTab<PatientDocumentView>> {
    return this.tabs.documents(user, patientId, query);
  }

  /**
   * API §4.7 — file an upload under the Documents tab. Body
   * `{ fileId, category }`; `fileId` from `POST /files` with kind
   * `patient_document`, the caller's own and not yet linked.
   */
  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  addDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(linkDocumentSchema)) body: LinkDocumentInput,
  ): Promise<PatientDocumentView> {
    return this.tabs.addDocument(user, patientId, body);
  }

  /**
   * API §4.7 — the signed URL for one document. Care scope before the
   * M25.3 scan gate, so `403 scan_pending` is not an existence oracle.
   * A JSON `{ url, expiresInSeconds }`, the shape `GET /files/{id}/download`
   * answers in.
   */
  @PhiRead('patient_document', { auditedByHandler: true })
  @Get('documents/:documentId/download')
  downloadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('documentId') documentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.tabs.downloadDocument(user, patientId, documentId);
  }

  /** API §4.5 — studies, grouped by category as the contract asks. */
  @PhiRead('patient_studies')
  @Get('studies')
  studies(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
  ): Promise<readonly StudyGroupView[]> {
    return this.tabs.studies(user, patientId);
  }

  /** API §4.5 — the patient's appointment history. */
  @PhiRead('patient_appointments')
  @Get('appointments')
  appointments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Query(zodQuery(tabQuerySchema)) query: TabQuery,
  ): Promise<PaginatedTab<PatientAppointmentView>> {
    return this.tabs.appointments(user, patientId, query);
  }
}
