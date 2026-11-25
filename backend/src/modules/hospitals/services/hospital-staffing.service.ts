/**
 * Hospital staffing lifecycle (multi-hospital §2.2–§2.6).
 *
 * | Operation | Who | Effect on the subject |
 * | --- | --- | --- |
 * | start a doctor's employment | Platform Admin, or the hospital's own Hospital Admin | clinical context from the next request (authz_version bump) |
 * | end it (termination) | same | sessions and refresh tokens revoked; login refused while none is active |
 * | transfer to another hospital | Platform Admin only | old employment ended, new one started, sessions revoked |
 * | start / end a staff affiliation | Platform Admin, or the hospital's Hospital Admin | as for doctors |
 * | assign / revoke a Hospital Admin | Platform Admin only | sessions revoked (a scope change is a role change) |
 * | grant / revoke Platform Admin | Platform Admin only, never to or by oneself | sessions revoked |
 *
 * Deny by default where the decision is silent: a Hospital Admin cannot move
 * a doctor into another hospital (that acts on two tenants), and the last
 * active Platform Admin grant cannot be revoked.
 *
 * Every operation is audited with actor, affected user, hospital, previous
 * and new values, and timestamp (§2.8, §2.13).
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { AdminScopeService, PermissionResolver } from '../../../shared/authz';
import { isLastPlatformAdminViolation, isUniqueViolation } from '../../../shared/database';
import type {
  EndAccessInput,
  GrantAdminInput,
  StartAffiliationInput,
  StartEmploymentInput,
  TransferInput,
} from '../dto/hospital-staffing.schema';
import { HospitalStaffingRepository } from '../repositories/hospital-staffing.repository';

export interface StaffingResult {
  readonly id: string;
  readonly hospitalId: string;
  readonly sessionsRevoked: number;
}

/** One employment as `GET /doctors/{doctorId}/employments` returns it. */
export interface EmploymentView {
  readonly id: string;
  readonly doctorId: string;
  readonly hospital: { readonly id: string; readonly name: string };
  readonly hospitalDepartmentId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** `endedAt === null`: the one employment that yields clinical context (DR-02). */
  readonly active: boolean;
}

@Injectable()
export class HospitalStaffingService {
  constructor(
    private readonly staffing: HospitalStaffingRepository,
    private readonly scopes: AdminScopeService,
    private readonly permissions: PermissionResolver,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  async startEmployment(
    actor: AuthenticatedUser,
    hospitalId: string,
    input: StartEmploymentInput,
  ): Promise<StaffingResult> {
    await this.scopes.requireHospital(actor, hospitalId);
    await this.requireActiveHospital(hospitalId);
    await this.requireDepartment(input.departmentId, hospitalId);

    const doctor = await this.staffing.doctor(input.doctorId);
    if (doctor === null || doctor.deletedAt !== null || doctor.roleCode !== 'doctor') {
      throw AppException.notFound('Doctor not found');
    }
    // One hospital at a time (§2.5): a move between hospitals is a transfer.
    const current = await this.staffing.activeEmploymentOf(doctor.id);
    if (current !== null) {
      throw AppException.conflict('The doctor already holds an active employment; use a transfer');
    }

    const id = await this.unique(() =>
      this.staffing.startEmployment({
        doctorId: doctor.id,
        userId: doctor.userId,
        hospitalId,
        departmentId: input.departmentId,
      }),
    );
    await this.permissions.forget(doctor.userId);
    await this.record(actor, 'hospital.doctor_employment_started', hospitalId, 'doctor_employment', id, {
      affectedUserId: doctor.userId,
      doctorId: doctor.id,
      previous: 'none',
      next: hospitalId,
      reason: input.reason,
    });
    return { id, hospitalId, sessionsRevoked: 0 };
  }

  /**
   * A doctor's employment history (OD-12; ported from PR #63). A Platform
   * Admin sees every employment; a Hospital Admin only its own hospital's,
   * and a doctor its hospital never employed is unknown (404, ADR-022).
   */
  async listEmployments(actor: AuthenticatedUser, doctorId: string): Promise<EmploymentView[]> {
    const hospitalId = await this.scopes.hospitalFilterFor(actor);
    const doctor = await this.staffing.doctor(doctorId);
    if (doctor === null || doctor.deletedAt !== null || doctor.roleCode !== 'doctor') {
      throw AppException.notFound('Doctor not found');
    }
    const rows = await this.staffing.employmentsOf(doctor.id, hospitalId);
    if (hospitalId !== null && rows.length === 0) throw AppException.notFound('Doctor not found');
    return rows.map((row) => ({
      id: row.id,
      doctorId: row.doctorId,
      hospital: { id: row.hospitalId, name: row.hospitalName },
      hospitalDepartmentId: row.hospitalDepartmentId,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
      active: row.endedAt === null,
    }));
  }

  async endEmployment(
    actor: AuthenticatedUser,
    hospitalId: string,
    employmentId: string,
    input: EndAccessInput,
  ): Promise<StaffingResult> {
    await this.scopes.requireHospital(actor, hospitalId);
    const employment = await this.staffing.employment(employmentId);
    // Another hospital's employment is answered as unknown, not forbidden.
    if (employment === null || employment.hospitalId !== hospitalId) {
      throw AppException.notFound('Employment not found');
    }
    if (employment.endedAt !== null) throw AppException.conflict('The employment has already ended');

    const sessionsRevoked = await this.staffing.endEmployment(employment);
    await this.permissions.forget(employment.userId);
    await this.record(actor, 'hospital.doctor_employment_ended', hospitalId, 'doctor_employment', employment.id, {
      affectedUserId: employment.userId,
      doctorId: employment.doctorId,
      previous: hospitalId,
      next: 'none',
      reason: input.reason,
      sessionsRevoked,
    });
    return { id: employment.id, hospitalId, sessionsRevoked };
  }

  async transfer(
    actor: AuthenticatedUser,
    doctorId: string,
    input: TransferInput,
  ): Promise<StaffingResult> {
    await this.scopes.requirePlatform(actor);
    await this.requireActiveHospital(input.toHospitalId);
    await this.requireDepartment(input.departmentId, input.toHospitalId);

    const from = await this.staffing.activeEmploymentOf(doctorId);
    if (from === null) throw AppException.conflict('The doctor holds no active employment to transfer');
    if (from.hospitalId === input.toHospitalId) {
      throw AppException.validation({ toHospitalId: ['The doctor is already employed there'] });
    }

    const result = await this.unique(() =>
      this.staffing.transfer({ from, toHospitalId: input.toHospitalId, departmentId: input.departmentId }),
    );
    await this.permissions.forget(from.userId);
    await this.record(actor, 'hospital.doctor_transferred', input.toHospitalId, 'doctor', doctorId, {
      affectedUserId: from.userId,
      previous: from.hospitalId,
      next: input.toHospitalId,
      endedEmploymentId: from.id,
      startedEmploymentId: result.employmentId,
      reason: input.reason,
      sessionsRevoked: result.sessionsRevoked,
    });
    return { id: result.employmentId, hospitalId: input.toHospitalId, sessionsRevoked: result.sessionsRevoked };
  }

  async startAffiliation(
    actor: AuthenticatedUser,
    hospitalId: string,
    input: StartAffiliationInput,
  ): Promise<StaffingResult> {
    await this.scopes.requireHospital(actor, hospitalId);
    await this.requireActiveHospital(hospitalId);
    await this.requireDepartment(input.departmentId, hospitalId);

    const staff = await this.staffing.staff(input.staffId);
    if (staff === null) throw AppException.notFound('Staff member not found');
    if (await this.staffing.hasActiveAffiliation(staff.id)) {
      throw AppException.conflict('The staff member is already affiliated with a hospital');
    }

    const id = await this.unique(() =>
      this.staffing.startAffiliation({
        staffId: staff.id,
        userId: staff.userId,
        hospitalId,
        departmentId: input.departmentId,
      }),
    );
    if (staff.userId !== null) await this.permissions.forget(staff.userId);
    await this.record(actor, 'hospital.staff_affiliation_started', hospitalId, 'staff_affiliation', id, {
      affectedUserId: staff.userId ?? 'none',
      staffId: staff.id,
      previous: 'none',
      next: hospitalId,
      reason: input.reason,
    });
    return { id, hospitalId, sessionsRevoked: 0 };
  }

  async endAffiliation(
    actor: AuthenticatedUser,
    hospitalId: string,
    affiliationId: string,
    input: EndAccessInput,
  ): Promise<StaffingResult> {
    await this.scopes.requireHospital(actor, hospitalId);
    const affiliation = await this.staffing.affiliation(affiliationId);
    if (affiliation === null || affiliation.hospitalId !== hospitalId) {
      throw AppException.notFound('Affiliation not found');
    }
    if (affiliation.endedAt !== null) throw AppException.conflict('The affiliation has already ended');

    const sessionsRevoked = await this.staffing.endAffiliation(affiliation);
    if (affiliation.userId !== null) await this.permissions.forget(affiliation.userId);
    await this.record(actor, 'hospital.staff_affiliation_ended', hospitalId, 'staff_affiliation', affiliation.id, {
      affectedUserId: affiliation.userId ?? 'none',
      staffId: affiliation.staffId,
      previous: hospitalId,
      next: 'none',
      reason: input.reason,
      sessionsRevoked,
    });
    return { id: affiliation.id, hospitalId, sessionsRevoked };
  }

  async assignHospitalAdmin(
    actor: AuthenticatedUser,
    hospitalId: string,
    input: GrantAdminInput,
  ): Promise<StaffingResult> {
    await this.scopes.requirePlatform(actor);
    await this.requireActiveHospital(hospitalId);
    const user = await this.adminAccount(input.userId);
    if (user.id === actor.id) throw AppException.forbidden('You cannot change your own scope');

    // Exactly one hospital, and never alongside platform scope (§2.3). The
    // database enforces both; these checks give the caller a 409, not a 500.
    if (await this.staffing.hasActivePlatformGrant(user.id)) {
      throw AppException.conflict('The account holds Platform Admin scope; revoke it first');
    }
    if (await this.staffing.hasAnyActiveRoleAssignment(user.id)) {
      throw AppException.conflict('The account already administers a hospital');
    }

    const result = await this.unique(() =>
      this.staffing.assignHospitalAdmin({ userId: user.id, hospitalId, actorId: actor.id }),
    );
    await this.permissions.forget(user.id);
    await this.record(actor, 'hospital.admin_assigned', hospitalId, 'user', user.publicId, {
      affectedUserId: user.id,
      previous: 'none',
      next: hospitalId,
      reason: input.reason,
      sessionsRevoked: result.sessionsRevoked,
    });
    return { id: result.id, hospitalId, sessionsRevoked: result.sessionsRevoked };
  }

  async revokeHospitalAdmin(
    actor: AuthenticatedUser,
    hospitalId: string,
    userPublicId: string,
    input: EndAccessInput,
  ): Promise<StaffingResult> {
    await this.scopes.requirePlatform(actor);
    const user = await this.adminAccount(userPublicId);
    const assignment = await this.staffing.activeHospitalAdminAssignment(user.id);
    if (assignment === null || assignment.hospitalId !== hospitalId) {
      throw AppException.notFound('Hospital Admin assignment not found');
    }

    const sessionsRevoked = await this.staffing.revokeHospitalAdmin(assignment.id, user.id);
    await this.permissions.forget(user.id);
    await this.record(actor, 'hospital.admin_revoked', hospitalId, 'user', user.publicId, {
      affectedUserId: user.id,
      previous: hospitalId,
      next: 'none',
      reason: input.reason,
      sessionsRevoked,
    });
    return { id: assignment.id, hospitalId, sessionsRevoked };
  }

  async grantPlatformAdmin(actor: AuthenticatedUser, input: GrantAdminInput): Promise<StaffingResult> {
    await this.scopes.requirePlatform(actor);
    const user = await this.adminAccount(input.userId);
    // Nobody grants themselves platform scope (§2.2); the table's CHECK
    // enforces the same.
    if (user.id === actor.id) throw AppException.forbidden('You cannot change your own scope');
    if (await this.staffing.activeHospitalAdminAssignment(user.id)) {
      throw AppException.conflict('The account administers a hospital; revoke that first');
    }
    if (await this.staffing.hasActivePlatformGrant(user.id)) {
      throw AppException.conflict('The account already holds Platform Admin scope');
    }

    const result = await this.unique(() =>
      this.staffing.grantPlatformAdmin({ userId: user.id, actorId: actor.id, reason: input.reason }),
    );
    await this.permissions.forget(user.id);
    await this.record(actor, 'platform.admin_granted', null, 'user', user.publicId, {
      affectedUserId: user.id,
      previous: 'none',
      next: 'platform',
      reason: input.reason,
      sessionsRevoked: result.sessionsRevoked,
    });
    return { id: result.id, hospitalId: '', sessionsRevoked: result.sessionsRevoked };
  }

  async revokePlatformAdmin(
    actor: AuthenticatedUser,
    userPublicId: string,
    input: EndAccessInput,
  ): Promise<StaffingResult> {
    await this.scopes.requirePlatform(actor);
    const user = await this.adminAccount(userPublicId);
    if (user.id === actor.id) throw AppException.forbidden('You cannot change your own scope');
    if (!(await this.staffing.hasActivePlatformGrant(user.id))) {
      throw AppException.notFound('Platform Admin grant not found');
    }
    if ((await this.staffing.countActivePlatformAdmins()) <= 1) {
      throw AppException.conflict('The last Platform Admin cannot be revoked');
    }

    const sessionsRevoked = await this.staffing
      .revokePlatformAdmin(user.id, actor.id)
      .catch((error: unknown) => {
        // The count above is a fast answer; this is the guarantee. The
        // database re-checks at COMMIT under a lock (F-10), so two
        // concurrent revocations cannot both pass.
        if (isLastPlatformAdminViolation(error)) {
          throw AppException.conflict('The last Platform Admin cannot be revoked');
        }
        throw error;
      });
    await this.permissions.forget(user.id);
    await this.record(actor, 'platform.admin_revoked', null, 'user', user.publicId, {
      affectedUserId: user.id,
      previous: 'platform',
      next: 'none',
      reason: input.reason,
      sessionsRevoked,
    });
    return { id: user.publicId, hospitalId: '', sessionsRevoked };
  }

  private async adminAccount(publicId: string) {
    const user = await this.staffing.userByPublicId(publicId);
    if (user === null) throw AppException.notFound('User not found');
    if (user.roleCode !== 'admin') {
      throw AppException.validation({ userId: ['Only an administrator account can hold admin scope'] });
    }
    if (user.status !== 'ACTIVE') {
      throw AppException.validation({ userId: ['The account is not active'] });
    }
    return user;
  }

  private async requireActiveHospital(hospitalId: string): Promise<void> {
    if ((await this.staffing.activeHospital(hospitalId)) === null) {
      throw AppException.notFound('Hospital not found');
    }
  }

  private async requireDepartment(departmentId: string | undefined, hospitalId: string): Promise<void> {
    if (departmentId !== undefined && !(await this.staffing.departmentBelongs(departmentId, hospitalId))) {
      throw AppException.validation({ departmentId: ['The department is not part of this hospital'] });
    }
  }

  /** A lost race against the one-active-row indexes is a 409, not a 500. */
  private async unique<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.conflict('A conflicting active row already exists');
      throw error;
    }
  }

  private async record(
    actor: AuthenticatedUser,
    action: string,
    hospitalId: string | null,
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
