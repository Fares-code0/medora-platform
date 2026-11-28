/**
 * Hospital, clinic, location and department administration (ADM-01).
 *
 * | Operation | Who |
 * | --- | --- |
 * | create / update a hospital, change its status | Platform Admin only |
 * | list / read hospitals | Platform Admin (all); Hospital Admin (its own) |
 * | clinics, locations, departments of hospital H | Platform Admin, or the Hospital Admin of H |
 *
 * Nothing is deleted: a clinic, location or department is deactivated
 * (`status`), a hospital is suspended or made inactive. A child addressed
 * under a hospital that does not own it is answered as unknown (404, the
 * same as a missing one). Every change is audited with its hospital. None
 * of these rows is PHI.
 */

import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { AdminScopeService } from '../../../shared/authz';
import { isUniqueViolation } from '../../../shared/database';
import type {
  CreateClinicInput,
  CreateDepartmentInput,
  CreateHospitalInput,
  CreateLocationInput,
  HospitalStatusChangeInput,
  ListClinicsQuery,
  ListDepartmentsQuery,
  ListHospitalsQuery,
  ListLocationsQuery,
  UpdateClinicInput,
  UpdateDepartmentInput,
  UpdateHospitalInput,
  UpdateLocationInput,
} from '../dto/hospital-admin.schema';
import {
  type ClinicRow,
  type DepartmentRow,
  HospitalAdminRepository,
  type HospitalRow,
  type LocationRow,
  type Page,
} from '../repositories/hospital-admin.repository';

export interface PageView<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export function pageView<T, R>(
  result: Page<R>,
  paging: { page: number; pageSize: number },
  map: (row: R) => T,
): PageView<T> {
  return {
    items: result.rows.map(map),
    page: paging.page,
    pageSize: paging.pageSize,
    totalItems: result.total,
    totalPages: Math.ceil(result.total / paging.pageSize),
  };
}

/** A unique-index violation is a 409, never a 500 (also covers a lost race). */
export async function orConflict<T>(write: () => Promise<T>, message: string): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw AppException.conflict(message);
    throw error;
  }
}

/** The names of the fields a patch sets: audit records which, never the values. */
export function changedFields(input: object): string {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort()
    .join(',');
}

export interface HospitalView {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly status: string;
  readonly timezone: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClinicView {
  readonly id: string;
  readonly publicId: string;
  readonly hospitalId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LocationView {
  readonly id: string;
  readonly hospitalId: string;
  readonly name: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly status: string;
  readonly timezone: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DepartmentView {
  readonly id: string;
  readonly hospitalId: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly catalogueDepartmentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const iso = (date: Date): string => date.toISOString();

const toHospital = (row: HospitalRow): HospitalView => ({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});
const toClinic = (row: ClinicRow): ClinicView => ({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});
const toLocation = (row: LocationRow): LocationView => ({
  ...row,
  latitude: row.latitude === null ? null : Number(row.latitude),
  longitude: row.longitude === null ? null : Number(row.longitude),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});
const toDepartment = (row: DepartmentRow): DepartmentView => ({
  ...row,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

@Injectable()
export class HospitalAdminService {
  constructor(
    private readonly repo: HospitalAdminRepository,
    private readonly scopes: AdminScopeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /* ── hospitals ── */

  async listHospitals(actor: AuthenticatedUser, query: ListHospitalsQuery): Promise<PageView<HospitalView>> {
    // Platform: every hospital. Hospital Admin: its own, whatever the filter.
    const id = await this.scopes.hospitalFilterFor(actor);
    const page = await this.repo.listHospitals({ id, status: query.status, q: query.q }, query);
    return pageView(page, query, toHospital);
  }

  async getHospital(actor: AuthenticatedUser, hospitalId: string): Promise<HospitalView> {
    await this.scopes.requireHospital(actor, hospitalId);
    return toHospital(await this.requireHospital(hospitalId));
  }

  async createHospital(actor: AuthenticatedUser, input: CreateHospitalInput): Promise<HospitalView> {
    await this.scopes.requirePlatform(actor);
    const row = await orConflict(
      () =>
        this.repo.createHospital({
          publicId: `hsp_${randomUUID()}`,
          name: input.name,
          legalName: input.legalName ?? null,
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
          phone: input.phone ?? null,
          email: input.email ?? null,
        }),
      'A hospital with that email already exists',
    );
    await this.record(actor, 'hospital.created', row.id, 'hospital', row.publicId, {
      status: row.status,
    });
    return toHospital(row);
  }

  async updateHospital(
    actor: AuthenticatedUser,
    hospitalId: string,
    input: UpdateHospitalInput,
  ): Promise<HospitalView> {
    await this.scopes.requirePlatform(actor);
    const current = await this.requireHospital(hospitalId);
    const row = await orConflict(
      () => this.repo.updateHospital(hospitalId, definedOnly(input)),
      'A hospital with that email already exists',
    );
    await this.record(actor, 'hospital.updated', hospitalId, 'hospital', current.publicId, {
      changed: changedFields(input),
    });
    return toHospital(row);
  }

  async changeHospitalStatus(
    actor: AuthenticatedUser,
    hospitalId: string,
    input: HospitalStatusChangeInput,
  ): Promise<HospitalView> {
    await this.scopes.requirePlatform(actor);
    const current = await this.requireHospital(hospitalId);
    if (current.status === input.status) {
      throw AppException.conflict(`The hospital is already ${input.status}`);
    }
    const row = await this.repo.updateHospital(hospitalId, { status: input.status });
    await this.record(actor, 'hospital.status_changed', hospitalId, 'hospital', current.publicId, {
      previous: current.status,
      next: input.status,
      reason: input.reason,
    });
    return toHospital(row);
  }

  /* ── clinics ── */

  async listClinics(
    actor: AuthenticatedUser,
    hospitalId: string,
    query: ListClinicsQuery,
  ): Promise<PageView<ClinicView>> {
    await this.scoped(actor, hospitalId);
    return pageView(await this.repo.listClinics(hospitalId, query, query), query, toClinic);
  }

  async getClinic(actor: AuthenticatedUser, hospitalId: string, clinicId: string): Promise<ClinicView> {
    await this.scoped(actor, hospitalId);
    return toClinic(await this.requireClinic(hospitalId, clinicId));
  }

  async createClinic(actor: AuthenticatedUser, hospitalId: string, input: CreateClinicInput): Promise<ClinicView> {
    await this.scoped(actor, hospitalId);
    const row = await orConflict(
      () =>
        this.repo.createClinic({
          publicId: `cln_${randomUUID()}`,
          hospitalId,
          name: input.name,
          ...(input.status === undefined ? {} : { status: input.status }),
        }),
      'A clinic with that name already exists at this hospital',
    );
    await this.record(actor, 'hospital.clinic_created', hospitalId, 'clinic', row.publicId, {
      status: row.status,
    });
    return toClinic(row);
  }

  async updateClinic(
    actor: AuthenticatedUser,
    hospitalId: string,
    clinicId: string,
    input: UpdateClinicInput,
  ): Promise<ClinicView> {
    await this.scoped(actor, hospitalId);
    const current = await this.requireClinic(hospitalId, clinicId);
    const row = await orConflict(
      () => this.repo.updateClinic(clinicId, definedOnly(input)),
      'A clinic with that name already exists at this hospital',
    );
    await this.record(actor, 'hospital.clinic_updated', hospitalId, 'clinic', current.publicId, {
      changed: changedFields(input),
      ...(input.status === undefined ? {} : { previous: current.status, next: input.status }),
    });
    return toClinic(row);
  }

  /* ── locations ── */

  async listLocations(
    actor: AuthenticatedUser,
    hospitalId: string,
    query: ListLocationsQuery,
  ): Promise<PageView<LocationView>> {
    await this.scoped(actor, hospitalId);
    return pageView(await this.repo.listLocations(hospitalId, query, query), query, toLocation);
  }

  async getLocation(actor: AuthenticatedUser, hospitalId: string, locationId: string): Promise<LocationView> {
    await this.scoped(actor, hospitalId);
    return toLocation(await this.requireLocation(hospitalId, locationId));
  }

  async createLocation(
    actor: AuthenticatedUser,
    hospitalId: string,
    input: CreateLocationInput,
  ): Promise<LocationView> {
    await this.scoped(actor, hospitalId);
    const row = await orConflict(
      () => this.repo.createLocation({ hospitalId, ...definedOnly(input) }),
      'A location with that name already exists at this hospital',
    );
    await this.record(actor, 'hospital.location_created', hospitalId, 'hospital_location', row.id, {
      status: row.status,
    });
    return toLocation(row);
  }

  async updateLocation(
    actor: AuthenticatedUser,
    hospitalId: string,
    locationId: string,
    input: UpdateLocationInput,
  ): Promise<LocationView> {
    await this.scoped(actor, hospitalId);
    const current = await this.requireLocation(hospitalId, locationId);
    const row = await orConflict(
      () => this.repo.updateLocation(locationId, definedOnly(input)),
      'A location with that name already exists at this hospital',
    );
    await this.record(actor, 'hospital.location_updated', hospitalId, 'hospital_location', current.id, {
      changed: changedFields(input),
      ...(input.status === undefined ? {} : { previous: current.status, next: input.status }),
    });
    return toLocation(row);
  }

  /* ── departments ── */

  async listDepartments(
    actor: AuthenticatedUser,
    hospitalId: string,
    query: ListDepartmentsQuery,
  ): Promise<PageView<DepartmentView>> {
    await this.scoped(actor, hospitalId);
    return pageView(await this.repo.listDepartments(hospitalId, query, query), query, toDepartment);
  }

  async getDepartment(
    actor: AuthenticatedUser,
    hospitalId: string,
    departmentId: string,
  ): Promise<DepartmentView> {
    await this.scoped(actor, hospitalId);
    return toDepartment(await this.requireDepartment(hospitalId, departmentId));
  }

  async createDepartment(
    actor: AuthenticatedUser,
    hospitalId: string,
    input: CreateDepartmentInput,
  ): Promise<DepartmentView> {
    await this.scoped(actor, hospitalId);
    await this.requireCatalogue(input.catalogueDepartmentId);
    const row = await orConflict(
      () => this.repo.createDepartment({ hospitalId, ...definedOnly(input) }),
      'A department with that name already exists at this hospital',
    );
    await this.record(actor, 'hospital.department_created', hospitalId, 'hospital_department', row.id, {
      status: row.status,
    });
    return toDepartment(row);
  }

  async updateDepartment(
    actor: AuthenticatedUser,
    hospitalId: string,
    departmentId: string,
    input: UpdateDepartmentInput,
  ): Promise<DepartmentView> {
    await this.scoped(actor, hospitalId);
    const current = await this.requireDepartment(hospitalId, departmentId);
    await this.requireCatalogue(input.catalogueDepartmentId);
    const row = await orConflict(
      () => this.repo.updateDepartment(departmentId, definedOnly(input)),
      'A department with that name already exists at this hospital',
    );
    await this.record(actor, 'hospital.department_updated', hospitalId, 'hospital_department', current.id, {
      changed: changedFields(input),
      ...(input.status === undefined ? {} : { previous: current.status, next: input.status }),
    });
    return toDepartment(row);
  }

  /* ── shared ── */

  /** Confines the caller to the hospital, then requires it to exist (404). */
  private async scoped(actor: AuthenticatedUser, hospitalId: string): Promise<void> {
    await this.scopes.requireHospital(actor, hospitalId);
    await this.requireHospital(hospitalId);
  }

  private async requireHospital(hospitalId: string): Promise<HospitalRow> {
    const row = await this.repo.hospital(hospitalId);
    if (row === null) throw AppException.notFound('Hospital not found');
    return row;
  }

  private async requireClinic(hospitalId: string, id: string): Promise<ClinicRow> {
    const row = await this.repo.clinic(hospitalId, id);
    if (row === null) throw AppException.notFound('Clinic not found');
    return row;
  }

  private async requireLocation(hospitalId: string, id: string): Promise<LocationRow> {
    const row = await this.repo.location(hospitalId, id);
    if (row === null) throw AppException.notFound('Location not found');
    return row;
  }

  private async requireDepartment(hospitalId: string, id: string): Promise<DepartmentRow> {
    const row = await this.repo.department(hospitalId, id);
    if (row === null) throw AppException.notFound('Department not found');
    return row;
  }

  private async requireCatalogue(id: string | null | undefined): Promise<void> {
    if (id === undefined || id === null) return;
    if (!(await this.repo.catalogueDepartmentExists(id))) {
      throw AppException.validation({ catalogueDepartmentId: ['Unknown catalogue department'] });
    }
  }

  private async record(
    actor: AuthenticatedUser,
    action: string,
    hospitalId: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, string | number>,
  ): Promise<void> {
    await this.audit.record({
      action,
      actor: { userId: actor.id, role: actor.role, sessionId: actor.sessionId },
      entityType,
      entityId,
      hospitalId,
      metadata,
    });
  }
}

/** A patch sets only the fields it names; `undefined` is "leave as is". */
export function definedOnly<T extends object>(input: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}
