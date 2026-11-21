import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { sendCsv } from '../../../common/http/csv-export';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can } from '../../../shared/authz';
import type {
  MedicalRecordDetailView,
  MedicalRecordView,
  RecordSummaryView,
  RecordVersionView,
} from '../dto/record.dto';
import {
  attachRecordFileSchema,
  createNoteSchema,
  createRecordSchema,
  recordExportSchema,
  recordListSchema,
  recordStatusSchema,
  reportIssueSchema,
  updateRecordSchema,
  type AttachRecordFileInput,
  type CreateNoteInput,
  type CreateRecordInput,
  type RecordExportQuery,
  type RecordListQuery,
  type RecordStatusInput,
  type ReportIssueInput,
  type UpdateRecordInput,
} from '../dto/record.schema';
import { RecordService, type PaginatedRecords } from '../services/record.service';

/**
 * The clinical document (RM M12 — API §6).
 *
 * ## Two capabilities, split exactly where the contract splits them
 *
 * `records.view` guards the reads, `records.edit` the writes, and the
 * class carries the narrower-by-default read capability with each write
 * naming its own. `@Can(...)` on a method **narrows** — the guard
 * requires every listed capability — so a write demands both, which is
 * the safe direction: a route that asks too much fails loudly in review,
 * one that asks too little fails silently in production.
 *
 * Holding either capability is still not a care relationship. Every
 * route resolves through `PatientScopeService`, and a record outside the
 * caller's care answers 404 — the same non-disclosing refusal a
 * genuinely missing one produces (ADR-022).
 *
 * ## Route ordering
 *
 * `GET /medical-records/summary` is declared before `GET /:recordId`.
 * Nest matches in declaration order, so the reverse would read
 * `summary` as a record reference and answer 404.
 *
 * ## `POST …/status` and not `PATCH { status }`
 *
 * The lifecycle is a guarded machine with its own 409, not a field
 * assignment. `PATCH` deliberately does **not** accept `status`: a
 * client that could set it through the general update would bypass the
 * machine, and the timeline event that makes a transition reviewable
 * would never be written.
 */
@Can('records.view')
@Controller('medical-records')
export class RecordController {
  constructor(private readonly records: RecordService) {}

  /** API §6.1. */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(recordListSchema)) query: RecordListQuery,
  ): Promise<PaginatedRecords> {
    return this.records.list(user, query);
  }

  /** API §6.10 — the cards. Declared before `:recordId`. */
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser): Promise<RecordSummaryView> {
    return this.records.summary(user);
  }

  /**
   * API §6.10 — the filtered list as CSV. Declared before `:recordId`,
   * for the reason `summary` is. A file, not an envelope.
   */
  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(recordExportSchema)) query: RecordExportQuery,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.records.export(user, query));
  }

  /** API §6.2 — the full clinical document. */
  @Get(':recordId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
  ): Promise<MedicalRecordDetailView> {
    return this.records.detail(user, recordId);
  }

  /** API §6.10 — one record as a `Field,Value` file, care-scoped like the detail. */
  @Get(':recordId/export')
  async exportOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.records.exportOne(user, recordId));
  }

  /** API §6.8 — the before/after trail. */
  @Get(':recordId/versions')
  versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
  ): Promise<readonly RecordVersionView[]> {
    return this.records.versions(user, recordId);
  }

  /** API §6.3 — create a draft, transactionally with its children. */
  @Can('records.edit')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createRecordSchema)) body: CreateRecordInput,
  ): Promise<MedicalRecordView> {
    return this.records.create(user, body);
  }

  /** API §6.4 — update fields and children; writes a version row. */
  @Can('records.edit')
  @Patch(':recordId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Body(zodBody(updateRecordSchema)) body: UpdateRecordInput,
  ): Promise<MedicalRecordDetailView> {
    return this.records.update(user, recordId, body);
  }

  /** API §6.5 — `draft → active → completed → archived`, guarded. */
  @Can('records.edit')
  @Post(':recordId/status')
  @HttpCode(HttpStatus.OK)
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Body(zodBody(recordStatusSchema)) body: RecordStatusInput,
  ): Promise<MedicalRecordDetailView> {
    return this.records.changeStatus(user, recordId, body);
  }

  /** API §6.6 — a clinical note, with its `aiAssisted` provenance. */
  @Can('records.edit')
  @Post(':recordId/notes')
  @HttpCode(HttpStatus.CREATED)
  addNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Body(zodBody(createNoteSchema)) body: CreateNoteInput,
  ): Promise<MedicalRecordDetailView> {
    return this.records.addNote(user, recordId, body);
  }

  /** API §6.6 — signing freezes the content. Author only. */
  @Can('records.edit')
  @Post(':recordId/notes/:noteId/sign')
  @HttpCode(HttpStatus.OK)
  signNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Param('noteId') noteId: string,
  ): Promise<MedicalRecordDetailView> {
    return this.records.signNote(user, recordId, noteId);
  }

  /**
   * API §6.7 — attach a file uploaded through `POST /files`.
   *
   * `records.edit`, as the contract says. The bytes are already stored and
   * scanned-pending; this files them on the encounter.
   */
  @Can('records.edit')
  @Post(':recordId/attachments')
  @HttpCode(HttpStatus.CREATED)
  attachFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Body(zodBody(attachRecordFileSchema)) body: AttachRecordFileInput,
  ): Promise<MedicalRecordDetailView> {
    return this.records.attachFile(user, recordId, body);
  }

  /**
   * API §6.7 — download one attachment, behind the scan gate.
   *
   * `records.view` rather than the contract row's `records.edit`: that
   * cell covers the upload, and a clinician who may read the record may
   * read what is filed on it — `GET /files/{id}/download` already lets
   * them, through the same care scope, so a stricter rule here would
   * guard nothing.
   */
  @Get(':recordId/attachments/:attachmentId/download')
  attachmentDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.records.attachmentDownload(user, recordId, attachmentId);
  }

  /**
   * API §6.9 — flag a data error into the admin queue.
   *
   * `records.view` only, deliberately: reporting that a record is wrong
   * is what a clinician who may *read* it should be able to do, and
   * requiring edit rights would mean the people most likely to spot an
   * error in someone else's chart are the ones who cannot report it.
   */
  @Post(':recordId/report-issue')
  @HttpCode(HttpStatus.CREATED)
  reportIssue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordId') recordId: string,
    @Body(zodBody(reportIssueSchema)) body: ReportIssueInput,
  ): Promise<{ id: string; status: string }> {
    return this.records.reportIssue(user, recordId, body);
  }
}
