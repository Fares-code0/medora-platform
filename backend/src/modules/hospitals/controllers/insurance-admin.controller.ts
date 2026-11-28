import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, HospitalScope, NotPhi, PlatformScope } from '../../../shared/authz';
import {
  createCoverageSchema,
  createProviderSchema,
  listCoverageQuerySchema,
  listProvidersQuerySchema,
  updateCoverageSchema,
  updateProviderSchema,
  type CreateCoverageInput,
  type CreateProviderInput,
  type ListCoverageQuery,
  type ListProvidersQuery,
  type UpdateCoverageInput,
  type UpdateProviderInput,
} from '../dto/insurance-admin.schema';
import type { PageView } from '../services/hospital-admin.service';
import {
  type CoverageView,
  InsuranceAdminService,
  type ProviderView,
} from '../services/insurance-admin.service';

const uuidParam = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

const NOT_PHI = 'insurance configuration: provider and plan names, codes and dates; no patient data';

/**
 * Insurance configuration (ADM-03). Providers are a platform lookup:
 * written by a Platform Admin, readable by any scoped administrator (a
 * Hospital Admin needs the list to configure coverage). Coverage rows
 * belong to one hospital: its Hospital Admin or a Platform Admin.
 */
@Controller()
export class InsuranceAdminController {
  constructor(private readonly insurance: InsuranceAdminService) {}

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('insurance-providers')
  listProviders(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(zodQuery(listProvidersQuerySchema)) query: ListProvidersQuery,
  ): Promise<PageView<ProviderView>> {
    return this.insurance.listProviders(actor, query);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('insurance-providers/:providerId')
  getProvider(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('providerId', uuidParam) providerId: string,
  ): Promise<ProviderView> {
    return this.insurance.getProvider(actor, providerId);
  }

  @Can('settings.manageSystem')
  @PlatformScope()
  @NotPhi(NOT_PHI)
  @Post('insurance-providers')
  createProvider(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(createProviderSchema)) body: CreateProviderInput,
  ): Promise<ProviderView> {
    return this.insurance.createProvider(actor, body);
  }

  @Can('settings.manageSystem')
  @PlatformScope()
  @NotPhi(NOT_PHI)
  @Patch('insurance-providers/:providerId')
  updateProvider(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('providerId', uuidParam) providerId: string,
    @Body(zodBody(updateProviderSchema)) body: UpdateProviderInput,
  ): Promise<ProviderView> {
    return this.insurance.updateProvider(actor, providerId, body);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId/insurance-coverage')
  listCoverage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Query(zodQuery(listCoverageQuerySchema)) query: ListCoverageQuery,
  ): Promise<PageView<CoverageView>> {
    return this.insurance.listCoverage(actor, hospitalId, query);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId/insurance-coverage/:coverageId')
  getCoverage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('coverageId', uuidParam) coverageId: string,
  ): Promise<CoverageView> {
    return this.insurance.getCoverage(actor, hospitalId, coverageId);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Post('hospitals/:hospitalId/insurance-coverage')
  addCoverage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(createCoverageSchema)) body: CreateCoverageInput,
  ): Promise<CoverageView> {
    return this.insurance.addCoverage(actor, hospitalId, body);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Patch('hospitals/:hospitalId/insurance-coverage/:coverageId')
  updateCoverage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('coverageId', uuidParam) coverageId: string,
    @Body(zodBody(updateCoverageSchema)) body: UpdateCoverageInput,
  ): Promise<CoverageView> {
    return this.insurance.updateCoverage(actor, hospitalId, coverageId, body);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Delete('hospitals/:hospitalId/insurance-coverage/:coverageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCoverage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('coverageId', uuidParam) coverageId: string,
  ): Promise<void> {
    return this.insurance.removeCoverage(actor, hospitalId, coverageId);
  }
}
