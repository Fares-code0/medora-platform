import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { Idempotent } from '../../../shared/idempotency';
import type { PrescriptionDetailView, PrescriptionSummaryView } from '../dto/prescription.dto';
import type { SafetyCheckView } from '../dto/safety.dto';
import {
  createPrescriptionNoteSchema,
  createPrescriptionSchema,
  discontinuePrescriptionSchema,
  prescriptionExportSchema,
  prescriptionListSchema,
  renewPrescriptionSchema,
  safetyCheckSchema,
  signPrescriptionSchema,
  type CreatePrescriptionInput,
  type CreatePrescriptionNoteInput,
  type DiscontinuePrescriptionInput,
  type PrescriptionExportQuery,
  type PrescriptionListQuery,
  type RenewPrescriptionInput,
  type SafetyCheckInput,
  type SignPrescriptionInput,
} from '../dto/prescription.schema';
import {
  PrescriptionService,
  type PaginatedPrescriptions,
} from '../services/prescription.service';

/**
 * Prescribing (RM M13 — API §7.5–§7.10).
 *
 * `prescriptions.create` on the class: every route here either writes a
 * prescription or screens one being written, and the contract marks each
 * of them `can:prescriptions.create`.
 *
 * ## Route ordering
 *
 * `POST /prescriptions/safety-check` is declared before any
 * `:prescriptionId` route. Nest matches in declaration order, so the
 * reverse would read `safety-check` as a prescription reference — and
 * the screen would answer 404 for every request.
 */
@Can('prescriptions.create')
@Controller('prescriptions')
export class PrescriptionController {
  constructor(private readonly prescriptions: PrescriptionService) {}

  /**
   * API §7.5 — the safety screen.
   *
   * 200 rather than 201: it creates nothing. A `POST` because the body
   * carries a patient id and a medication id, and those belong in a body
   * rather than in a query string that lands in access logs (MG §11.6).
   */
  @Post('safety-check')
  @HttpCode(HttpStatus.OK)
  safetyCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(safetyCheckSchema)) body: SafetyCheckInput,
  ): Promise<SafetyCheckView> {
    return this.prescriptions.safetyCheck(user, body);
  }

  /** API §7.6 — create a draft. 201, because it creates a resource. */
  @Post()
  @Idempotent()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createPrescriptionSchema)) body: CreatePrescriptionInput,
  ): Promise<PrescriptionDetailView> {
    return this.prescriptions.create(user, body);
  }

  /** API §7.3 — the prescriber's own list. */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(prescriptionListSchema)) query: PrescriptionListQuery,
  ): Promise<PaginatedPrescriptions> {
    return this.prescriptions.list(user, query);
  }

  /**
   * API §7 — the summary cards (RM M27.4).
   *
   * Declared before `:prescriptionId`, like `safety-check`: the reverse
   * order reads `summary` as a prescription reference and answers 404 for
   * a route that exists.
   */
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser): Promise<PrescriptionSummaryView> {
    return this.prescriptions.summary(user);
  }

  /**
   * API §7.10 — the prescriber's filtered list as CSV. Declared before
   * `:prescriptionId`, like `summary`. A file, not an envelope.
   */
  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(prescriptionExportSchema)) query: PrescriptionExportQuery,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.prescriptions.export(user, query));
  }

  /** API §7.4 — the full document. */
  @Get(':prescriptionId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('prescriptionId') prescriptionId: string,
  ): Promise<PrescriptionDetailView> {
    return this.prescriptions.detail(user, prescriptionId);
  }

  /**
   * API §7.7 — sign & send.
   *
   * 200 rather than 201: the prescription already exists; this changes
   * its state. The body is optional — a clean prescription needs neither
   * an acknowledgment nor a reason, and demanding them would refuse the
   * common case.
   */
  @Post(':prescriptionId/sign')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  sign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('prescriptionId') prescriptionId: string,
    @Body(zodBody(signPrescriptionSchema)) body: SignPrescriptionInput,
  ): Promise<PrescriptionDetailView> {
    return this.prescriptions.sign(user, prescriptionId, body);
  }

  /** API §7.8 — a pre-filled draft from a prior prescription. 201: new row. */
  @Post(':prescriptionId/renew')
  @Idempotent()
  renew(
    @CurrentUser() user: AuthenticatedUser,
    @Param('prescriptionId') prescriptionId: string,
    @Body(zodBody(renewPrescriptionSchema)) body: RenewPrescriptionInput,
  ): Promise<PrescriptionDetailView> {
    return this.prescriptions.renew(user, prescriptionId, body);
  }

  /**
   * API §7.9 — stop an active therapy. P4: the reason is required.
   *
   * Two routes, one status (ADR-002 §4). They are kept distinct because
   * they carry different audit semantics, and the act is recorded in the
   * audit event and the timeline detail rather than in the status column.
   */
  @Post(':prescriptionId/discontinue')
  @HttpCode(HttpStatus.OK)
  discontinue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('prescriptionId') prescriptionId: string,
    @Body(zodBody(discontinuePrescriptionSchema)) body: DiscontinuePrescriptionInput,
  ): Promise<PrescriptionDetailView> {
    return this.prescriptions.discontinue(user, prescriptionId, body, 'discontinue');
  }

  /** API §7.9 — withdraw a prescription. Same status, different act. */
  @Post(':prescriptionId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('prescriptionId') prescriptionId: string,
    @Body(zodBody(discontinuePrescriptionSchema)) body: DiscontinuePrescriptionInput,
  ): Promise<PrescriptionDetailView> {
    return this.prescriptions.discontinue(user, prescriptionId, body, 'cancel');
  }

  /**
   * BR-DEC-002 — discard an unsigned draft (ADR-044: a soft delete).
   *
   * `DELETE` because that is what the act is from the client's side: the
   * draft leaves every list. Only a draft, only its prescriber.
   */
  @Delete(':prescriptionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  discard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('prescriptionId') prescriptionId: string,
  ): Promise<void> {
    return this.prescriptions.discard(user, prescriptionId);
  }

  /** API §7.10 — a note on the prescription. */
  @Post(':prescriptionId/notes')
  @HttpCode(HttpStatus.CREATED)
  addNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('prescriptionId') prescriptionId: string,
    @Body(zodBody(createPrescriptionNoteSchema)) body: CreatePrescriptionNoteInput,
  ): Promise<PrescriptionDetailView> {
    return this.prescriptions.addNote(user, prescriptionId, body);
  }
}
