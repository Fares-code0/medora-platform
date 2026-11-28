import {
  Body,
  Controller,
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
  createClinicSchema,
  createDepartmentSchema,
  createHospitalSchema,
  createLocationSchema,
  hospitalStatusChangeSchema,
  listClinicsQuerySchema,
  listDepartmentsQuerySchema,
  listHospitalsQuerySchema,
  listLocationsQuerySchema,
  updateClinicSchema,
  updateDepartmentSchema,
  updateHospitalSchema,
  updateLocationSchema,
  type CreateClinicInput,
  type CreateDepartmentInput,
  type CreateHospitalInput,
  type CreateLocationInput,
  type HospitalStatusChangeInput,
  type ListClinicsQuery,
  type ListDepartmentsQuery,
  type ListHospitalsQuery,
  type ListLocationsQuery,
  type UpdateClinicInput,
  type UpdateDepartmentInput,
  type UpdateHospitalInput,
  type UpdateLocationInput,
} from '../dto/hospital-admin.schema';
import {
  type ClinicView,
  type DepartmentView,
  HospitalAdminService,
  type HospitalView,
  type LocationView,
  type PageView,
} from '../services/hospital-admin.service';

/** A malformed id is an unknown resource, answered as such. */
const uuidParam = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

const NOT_PHI = 'hospital organisation configuration: names, addresses and status; no patient data';

/**
 * Hospital, clinic, location and department administration (ADM-01).
 *
 * Capability first (`settings.manageSystem`, admin-only by the server
 * policy), then tier. Hospital creation, edit and status are
 * `@PlatformScope()`: they act across hospitals. Reads and the clinic,
 * location and department routes are `@HospitalScope()`: a Hospital Admin
 * is confined to its own hospital in the service (403 for another's), a
 * Platform Admin reaches any. Nothing is deleted; a row is deactivated by
 * its `status`.
 */
@Controller()
export class HospitalAdminController {
  constructor(private readonly admin: HospitalAdminService) {}

  /* ── hospitals ── */

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals')
  listHospitals(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(zodQuery(listHospitalsQuerySchema)) query: ListHospitalsQuery,
  ): Promise<PageView<HospitalView>> {
    return this.admin.listHospitals(actor, query);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId')
  getHospital(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
  ): Promise<HospitalView> {
    return this.admin.getHospital(actor, hospitalId);
  }

  @Can('settings.manageSystem')
  @PlatformScope()
  @NotPhi(NOT_PHI)
  @Post('hospitals')
  createHospital(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(createHospitalSchema)) body: CreateHospitalInput,
  ): Promise<HospitalView> {
    return this.admin.createHospital(actor, body);
  }

  @Can('settings.manageSystem')
  @PlatformScope()
  @NotPhi(NOT_PHI)
  @Patch('hospitals/:hospitalId')
  updateHospital(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(updateHospitalSchema)) body: UpdateHospitalInput,
  ): Promise<HospitalView> {
    return this.admin.updateHospital(actor, hospitalId, body);
  }

  @Can('settings.manageSystem')
  @PlatformScope()
  @NotPhi(NOT_PHI)
  @Post('hospitals/:hospitalId/status')
  @HttpCode(HttpStatus.OK)
  changeHospitalStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(hospitalStatusChangeSchema)) body: HospitalStatusChangeInput,
  ): Promise<HospitalView> {
    return this.admin.changeHospitalStatus(actor, hospitalId, body);
  }

  /* ── clinics ── */

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId/clinics')
  listClinics(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Query(zodQuery(listClinicsQuerySchema)) query: ListClinicsQuery,
  ): Promise<PageView<ClinicView>> {
    return this.admin.listClinics(actor, hospitalId, query);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId/clinics/:clinicId')
  getClinic(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('clinicId', uuidParam) clinicId: string,
  ): Promise<ClinicView> {
    return this.admin.getClinic(actor, hospitalId, clinicId);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Post('hospitals/:hospitalId/clinics')
  createClinic(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(createClinicSchema)) body: CreateClinicInput,
  ): Promise<ClinicView> {
    return this.admin.createClinic(actor, hospitalId, body);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Patch('hospitals/:hospitalId/clinics/:clinicId')
  updateClinic(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('clinicId', uuidParam) clinicId: string,
    @Body(zodBody(updateClinicSchema)) body: UpdateClinicInput,
  ): Promise<ClinicView> {
    return this.admin.updateClinic(actor, hospitalId, clinicId, body);
  }

  /* ── locations ── */

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId/locations')
  listLocations(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Query(zodQuery(listLocationsQuerySchema)) query: ListLocationsQuery,
  ): Promise<PageView<LocationView>> {
    return this.admin.listLocations(actor, hospitalId, query);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId/locations/:locationId')
  getLocation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('locationId', uuidParam) locationId: string,
  ): Promise<LocationView> {
    return this.admin.getLocation(actor, hospitalId, locationId);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Post('hospitals/:hospitalId/locations')
  createLocation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(createLocationSchema)) body: CreateLocationInput,
  ): Promise<LocationView> {
    return this.admin.createLocation(actor, hospitalId, body);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Patch('hospitals/:hospitalId/locations/:locationId')
  updateLocation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('locationId', uuidParam) locationId: string,
    @Body(zodBody(updateLocationSchema)) body: UpdateLocationInput,
  ): Promise<LocationView> {
    return this.admin.updateLocation(actor, hospitalId, locationId, body);
  }

  /* ── departments ── */

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId/departments')
  listDepartments(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Query(zodQuery(listDepartmentsQuerySchema)) query: ListDepartmentsQuery,
  ): Promise<PageView<DepartmentView>> {
    return this.admin.listDepartments(actor, hospitalId, query);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Get('hospitals/:hospitalId/departments/:departmentId')
  getDepartment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('departmentId', uuidParam) departmentId: string,
  ): Promise<DepartmentView> {
    return this.admin.getDepartment(actor, hospitalId, departmentId);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Post('hospitals/:hospitalId/departments')
  createDepartment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(createDepartmentSchema)) body: CreateDepartmentInput,
  ): Promise<DepartmentView> {
    return this.admin.createDepartment(actor, hospitalId, body);
  }

  @Can('settings.manageSystem')
  @HospitalScope()
  @NotPhi(NOT_PHI)
  @Patch('hospitals/:hospitalId/departments/:departmentId')
  updateDepartment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('departmentId', uuidParam) departmentId: string,
    @Body(zodBody(updateDepartmentSchema)) body: UpdateDepartmentInput,
  ): Promise<DepartmentView> {
    return this.admin.updateDepartment(actor, hospitalId, departmentId, body);
  }
}
