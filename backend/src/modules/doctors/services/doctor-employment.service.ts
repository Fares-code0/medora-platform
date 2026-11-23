/**
 * The doctor employment lifecycle (OD-12, gap G3, stage S6 — GitHub #54).
 *
 * ## Who may call it
 *
 * `doctors.manage`, i.e. today's `admin` role, which is platform-wide
 * (OD-07, GitHub #16: Platform Admin has platform-wide administrative
 * scope including membership management; it never grants PHI). Hospital
 * Admin scoping is **not** implemented here: its mapping is a pending
 * decision, and every route below acts on any hospital.
 *
 * ## Errors
 *
 * - unknown or soft-deleted doctor, unknown or soft-deleted hospital,
 *   unknown employment (or one belonging to another doctor) → 404
 *   (ADR-022: unknown is 404, never 403);
 * - hospital not `ACTIVE` → 409 `hospital_inactive`;
 * - department not in that hospital → 422 on `hospitalDepartmentId`;
 * - doctor already has an active employment (DR-02, the database's
 *   partial unique index) → 409 `employment_active`;
 * - employment already ended → 409 `invalid_status_transition`.
 *
 * ## The audit rows
 *
 * `doctor.employment_started` and `doctor.employment_ended`, written on the
 * mutation's own transaction through `TransactionalAuditWriter`, so the
 * change and its record commit together. Metadata only: ids and counts,
 * never a patient. The audit row's `hospital_id` column is **not** set:
 * `AuditEvent` has no hospital field and `auditRowOf` never writes one,
 * so the hospital is carried in `metadata.hospitalId` instead (changing
 * the audit kernel is outside this module).
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { TransactionalAuditWriter } from '../../../shared/audit';
import { isUniqueViolation } from '../../../shared/database';
import type { DoctorEmploymentView, EndEmploymentResult } from '../dto/doctor-employment.dto';
import type { StartEmploymentInput } from '../dto/doctor-employment.schema';
import {
  DoctorEmploymentRepository,
  type EmploymentRow,
} from '../repositories/doctor-employment.repository';

/** The only hospital status that may take on a new employment. */
const ACTIVE_HOSPITAL_STATUS = 'ACTIVE';

@Injectable()
export class DoctorEmploymentService {
  constructor(
    private readonly employments: DoctorEmploymentRepository,
    private readonly audit: TransactionalAuditWriter,
  ) {}

  /** `GET /doctors/{doctorId}/employments` — newest first. */
  async list(doctorId: string): Promise<DoctorEmploymentView[]> {
    const doctor = await this.employments.findDoctor(doctorId);
    if (doctor === null) throw AppException.notFound('Doctor not found');

    const rows = await this.employments.listFor(doctor.id);
    return rows.map(toView);
  }

  /** `POST /doctors/{doctorId}/employments`. */
  async start(
    actor: AuthenticatedUser,
    doctorId: string,
    input: StartEmploymentInput,
  ): Promise<DoctorEmploymentView> {
    const doctor = await this.employments.findDoctor(doctorId);
    if (doctor === null) throw AppException.notFound('Doctor not found');

    const hospital = await this.employments.findHospital(input.hospitalId);
    if (hospital === null) throw AppException.notFound('Hospital not found');
    if (hospital.status !== ACTIVE_HOSPITAL_STATUS) {
      throw AppException.conflict('The hospital is not active', 'hospital_inactive');
    }

    let departmentId: string | null = null;
    if (input.hospitalDepartmentId !== undefined) {
      const department = await this.employments.findDepartment(
        hospital.id,
        input.hospitalDepartmentId,
      );
      if (department === null) {
        throw AppException.validation(
          { hospitalDepartmentId: ['Not a department of this hospital'] },
          'Unknown hospital department',
        );
      }
      departmentId = department.id;
    }

    try {
      const row = await this.employments.start(
        { doctorId: doctor.id, hospitalId: hospital.id, hospitalDepartmentId: departmentId },
        (tx, created) =>
          this.audit.recordWithin(tx, {
            action: 'doctor.employment_started',
            actor: { userId: actor.id, role: actor.role, sessionId: actor.sessionId },
            entityType: 'doctor',
            entityId: doctor.id,
            metadata: {
              employmentId: created.id,
              hospitalId: created.hospitalId,
              hospitalDepartmentId: created.hospitalDepartmentId,
            },
          }),
      );
      return toView(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'The doctor already has an active employment; end it first',
          'employment_active',
        );
      }
      throw error;
    }
  }

  /**
   * `POST /doctors/{doctorId}/employments/{employmentId}/end`.
   *
   * OD-12: immediate, no grace period. The employment, its care
   * assignments, the doctor's sessions and the audit row change in one
   * transaction (`DoctorEmploymentRepository.end`).
   *
   * Works for a soft-deleted doctor too: ending is the direction that
   * removes access, and refusing it would leave a live employment no
   * route could close.
   */
  async end(
    actor: AuthenticatedUser,
    doctorId: string,
    employmentId: string,
  ): Promise<EndEmploymentResult> {
    const outcome = await this.employments.end(doctorId, employmentId, (tx, ended) =>
      this.audit.recordWithin(tx, {
        action: 'doctor.employment_ended',
        actor: { userId: actor.id, role: actor.role, sessionId: actor.sessionId },
        entityType: 'doctor',
        entityId: ended.employment.doctorId,
        metadata: {
          employmentId: ended.employment.id,
          hospitalId: ended.employment.hospitalId,
          hospitalDepartmentId: ended.employment.hospitalDepartmentId,
          revokedAssignments: ended.revokedAssignments,
          revokedSessions: ended.revokedSessions,
          legacyAssignmentsUntouched: ended.legacyAssignmentsUntouched,
        },
      }),
    );

    if (outcome.kind === 'not_found') throw AppException.notFound('Employment not found');
    if (outcome.kind === 'already_ended') {
      throw AppException.conflict('The employment has already ended', 'invalid_status_transition');
    }

    return {
      employment: toView(outcome.employment),
      revokedAssignments: outcome.revokedAssignments,
      revokedSessions: outcome.revokedSessions,
    };
  }
}

function toView(row: EmploymentRow): DoctorEmploymentView {
  return {
    id: row.id,
    doctorId: row.doctorId,
    hospital: { id: row.hospital.publicId, name: row.hospital.name },
    hospitalDepartment:
      row.department === null ? null : { id: row.department.id, name: row.department.name },
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    active: row.endedAt === null,
  };
}
