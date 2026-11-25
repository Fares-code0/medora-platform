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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { sendCsv } from '../../../common/http/csv-export';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, HospitalScope, PhiRead } from '../../../shared/authz';
import type { MaskedIdentity } from '../../../shared/phi';
import type {
  PatientAlertView,
  PatientAllergyView,
  PatientProfileBundle,
  PatientView,
  RevealedIdentity,
} from '../dto/patient.dto';
import {
  createAlertSchema,
  createAllergySchema,
  createPatientSchema,
  patientExportSchema,
  patientListSchema,
  revealIdentitySchema,
  updateAlertSchema,
  updateAllergySchema,
  updatePatientSchema,
  type CreateAlertInput,
  type CreateAllergyInput,
  type CreatePatientInput,
  type PatientExportQuery,
  type PatientListQuery,
  type RevealIdentityInput,
  type UpdateAlertInput,
  type UpdateAllergyInput,
  type UpdatePatientInput,
} from '../dto/patient.schema';
import { PatientService, type PaginatedPatients } from '../services/patient.service';

/**
 * The clinician's patient surface (RM M10 — API §4).
 *
 * ## The capability, and the second decision inside it
 *
 * `@Can('patients.view')` is the contract's rule for the reads. It is
 * only half the decision: holding the capability gets an administrator
 * the **masked** directory, and gets a doctor their **own** patients in
 * the clear. `PatientScopeService` makes the second half, per record,
 * and reconciliation §5 rule 5 is why it is not folded into the guard —
 * "authorization never asks 'is this the admin'", and a capability check
 * that special-cased an identity would be the defect that rule names.
 *
 * The **writes** carry `@Can('patients.view')` too rather than a
 * separate capability, because the matrix has none: `patients.view` is
 * what the doctor bundle holds for chart access, and
 * `patients.manageAccounts` is the *administrator's* governance
 * capability (API §4.11, M10.7) over accounts rather than over clinical
 * content. Every write path additionally goes through `assertCanReach`,
 * which is what actually stops an administrator editing a chart: they
 * hold no care relationship, so the service refuses them with the same
 * 404 a stranger's chart produces.
 *
 * ## Ordering
 *
 * Static segments are declared before `:patientId` ones. Nest matches in
 * declaration order, so `GET /patients/export` under a `:patientId`
 * route would be read as a patient id and answer 404 — the same trap
 * `GET /notifications/badge-counts` documents at M19.
 */
@Can('patients.view')
@Controller('patients')
export class PatientController {
  constructor(private readonly patients: PatientService) {}

  /** API §4.1 — the list. Clear for a doctor, masked for anyone else. */
  // A Hospital Admin reaches its own hospital's masked directory (F-08,
  // OD-07); a Platform Admin's is empty.
  @HospitalScope()
  @PhiRead('patient_list')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(patientListSchema)) query: PatientListQuery,
  ): Promise<PaginatedPatients<PatientView | MaskedIdentity>> {
    return this.patients.list(user, query);
  }

  /**
   * API §4.10 — the filtered list as CSV. Declared before `:patientId`
   * (see the header). A file rather than an envelope: a client saves it,
   * and wrapping a spreadsheet in `{ data: … }` would make every consumer
   * unwrap one.
   */
  @HospitalScope()
  @PhiRead('patient_export', { auditedByHandler: true })
  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(patientExportSchema)) query: PatientExportQuery,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.patients.export(user, query));
  }

  /** API §4.2 — register a patient, and assign them to the registering doctor. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createPatientSchema)) body: CreatePatientInput,
  ): Promise<PatientView> {
    return this.patients.create(user, body);
  }

  /** API §4.3 — one patient, with the derived fields. */
  @HospitalScope()
  @PhiRead('patient', { auditedByHandler: true })
  @Get(':patientId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
  ): Promise<PatientView | MaskedIdentity> {
    return this.patients.detail(user, patientId);
  }

  /**
   * API §4.9 — unmask an identity, atomically audit-logged (RM M7.3).
   *
   * `@Can` here replaces the class's `patients.view` rather than adding to
   * it (the guard reads the nearest rule), so the reveal is gated on the
   * one capability the contract names for it. `200`, not `201`: nothing
   * is created that the client can address afterwards.
   */
  @Post(':patientId/reveal')
  @HttpCode(HttpStatus.OK)
  @Can('patients.revealIdentity')
  reveal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(revealIdentitySchema)) body: RevealIdentityInput,
  ): Promise<RevealedIdentity> {
    return this.patients.revealIdentity(user, patientId, body);
  }

  /** API §4.4 — the profile bundle the chart screen loads first. */
  @HospitalScope()
  @PhiRead('patient_profile', { auditedByHandler: true })
  @Get(':patientId/profile')
  profile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
  ): Promise<PatientProfileBundle> {
    return this.patients.profile(user, patientId);
  }

  /** API §4.8 — status, risk level and contact details. */
  @Patch(':patientId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(updatePatientSchema)) body: UpdatePatientInput,
  ): Promise<PatientView> {
    return this.patients.update(user, patientId, body);
  }

  /**
   * Soft deactivation. API §4: "patient deletion does not exist".
   *
   * `DELETE` as the verb with a soft outcome is deliberate: it is what a
   * client's REST vocabulary offers for "remove this from my list", and
   * the server's job is to make that mean the safe thing rather than to
   * refuse the verb. The row keeps its clinical history and the audit
   * event records `softDeleted: true`.
   */
  @Delete(':patientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
  ): Promise<void> {
    return this.patients.deactivate(user, patientId);
  }

  /** API §4.5/§4.6 — the allergy list behind the fixed safety strip. */
  @PhiRead('patient_allergies')
  @Get(':patientId/allergies')
  allergies(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
  ): Promise<readonly PatientAllergyView[]> {
    return this.patients.allergies(user, patientId);
  }

  @Post(':patientId/allergies')
  @HttpCode(HttpStatus.CREATED)
  addAllergy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(createAllergySchema)) body: CreateAllergyInput,
  ): Promise<PatientAllergyView> {
    return this.patients.addAllergy(user, patientId, body);
  }

  @Patch(':patientId/allergies/:allergyId')
  updateAllergy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('allergyId') allergyId: string,
    @Body(zodBody(updateAllergySchema)) body: UpdateAllergyInput,
  ): Promise<PatientAllergyView> {
    return this.patients.updateAllergy(user, patientId, allergyId, body);
  }

  /** Soft-removed: an allergy once believed is a clinical fact. */
  @Delete(':patientId/allergies/:allergyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAllergy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('allergyId') allergyId: string,
  ): Promise<void> {
    return this.patients.removeAllergy(user, patientId, allergyId);
  }

  /**
   * API §4.5 — clinical alerts (M10.5).
   *
   * Active only by default: a resolved alert is history, and a banner a
   * clinician cannot dismiss (DB §B12) must not be drawn from one.
   */
  @PhiRead('clinical_alerts')
  @Get(':patientId/alerts')
  alerts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Query('includeResolved') includeResolved?: string,
  ): Promise<readonly PatientAlertView[]> {
    return this.patients.alerts(user, patientId, includeResolved !== 'true');
  }

  @Post(':patientId/alerts')
  @HttpCode(HttpStatus.CREATED)
  addAlert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(createAlertSchema)) body: CreateAlertInput,
  ): Promise<PatientAlertView> {
    return this.patients.addAlert(user, patientId, body);
  }

  /** Resolving an alert is `active: false`. The row is never deleted. */
  @Patch(':patientId/alerts/:alertId')
  updateAlert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Param('alertId') alertId: string,
    @Body(zodBody(updateAlertSchema)) body: UpdateAlertInput,
  ): Promise<PatientAlertView> {
    return this.patients.updateAlert(user, patientId, alertId, body);
  }
}
