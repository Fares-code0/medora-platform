import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../database';
import type {
  HospitalPatientScopeRepository,
  LiveAssignmentScope,
} from './hospital-patient-scope.shadow';
import { ACTIVE_HOSPITAL_STATUS } from './prisma-hospital-context.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only: the same live-assignment predicate as `isAssigned`, plus scope columns.
 *
 * ## Bounded (C1, issue #26)
 *
 * This query exists only for the shadow, so it must never compete with real
 * traffic for long. It runs in its own short interactive transaction whose
 * first statement is `set_config('statement_timeout', <ms>, true)`:
 *
 * - **transaction-local** (`true`): reset at commit or rollback, so it never
 *   reaches the next request that borrows the pooled connection — the
 *   pattern `RLS_BACKEND_CONTRACT.md` §5 specifies and
 *   `database-statement-timeout.e2e-spec.ts` proves; a session-level
 *   setting would leak;
 * - it cancels a slow **or lock-blocked** statement with `57014`, which
 *   rejects the comparison (caught and logged by `PatientScopeService`);
 * - the same bound caps the wait for a pool connection (`maxWait`) and the
 *   transaction as a whole (`timeout`), so a starved pool cannot hold the
 *   comparison either.
 *
 * Neither role- nor database-level timeouts are touched (Database-owned, and
 * shared with migrations and long operations).
 */
@Injectable()
export class PrismaHospitalPatientScopeRepository implements HospitalPatientScopeRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async liveAssignmentScopes(
    doctorUserId: string,
    patientId: string,
  ): Promise<readonly LiveAssignmentScope[]> {
    const timeoutMs = this.config.hospitalScopeShadowLimits.statementTimeoutMs;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`;
        return this.query(tx, doctorUserId, patientId);
      },
      { maxWait: timeoutMs, timeout: timeoutMs * 2 },
    );
  }

  /**
   * The base transaction client, not `prisma.db`: `patient_doctor_assignments`
   * has no `deleted_at`, so the soft-delete extension adds nothing to this
   * top-level read, and it never rewrites relation filters anyway.
   */
  private async query(
    tx: Prisma.TransactionClient,
    doctorUserId: string,
    patientId: string,
  ): Promise<readonly LiveAssignmentScope[]> {
    const rows = await tx.patientDoctorAssignment.findMany({
      where: {
        revokedAt: null,
        doctor: { userId: doctorUserId },
        patient: {
          OR: [{ publicId: patientId }, ...(UUID.test(patientId) ? [{ id: patientId }] : [])],
        },
      },
      select: {
        hospitalId: true,
        hospitalMedicalRecordId: true,
        doctorEmploymentId: true,
        doctorEmployment: { select: { endedAt: true } },
        hospitalMedicalRecord: {
          select: { hospital: { select: { status: true, deletedAt: true } } },
        },
      },
      // Two is enough to detect ambiguity; the shadow rule never picks one.
      take: 2,
    });

    return rows.map((row) => ({
      hospitalId: row.hospitalId,
      hospitalMedicalRecordId: row.hospitalMedicalRecordId,
      doctorEmploymentId: row.doctorEmploymentId,
      employmentEndedAt: row.doctorEmployment?.endedAt ?? null,
      // Same allow-list as the hospital context; unknown states fail closed.
      hospitalActive:
        row.hospitalMedicalRecord?.hospital.status === ACTIVE_HOSPITAL_STATUS &&
        row.hospitalMedicalRecord.hospital.deletedAt === null,
    }));
  }
}
