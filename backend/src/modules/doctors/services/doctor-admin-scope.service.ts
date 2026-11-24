import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { PrismaService } from '../../../shared/database';
import { hospitalFilterOf, type ResolvedAdminScope } from '../../../shared/authz';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Doctor administration under an administrative scope (S5; OD-07).
 *
 * A **Platform Admin** administers every doctor (unchanged). A **Hospital
 * Admin** administers only its hospital's doctors: a doctor is in a
 * hospital's scope while they hold an **active** employment there (one per
 * doctor, `doctor_employments_one_active_per_doctor_key`). Every other doctor,
 * and every employment of another hospital, is 404 (ADR-022) — the same
 * answer as a doctor or employment that does not exist.
 *
 * Hiring is the one route that reaches a doctor who is not yet in scope: a
 * Hospital Admin may start an employment only **at its own hospital**, and
 * only for a doctor with no active employment elsewhere — a doctor employed
 * by another hospital is 404 rather than the `employment_active` 409, which
 * would confirm another hospital's staff.
 */
@Injectable()
export class DoctorAdminScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** For a doctor route: 404 unless the doctor is in the caller's scope. */
  async assertDoctor(scope: ResolvedAdminScope, doctorId: string): Promise<void> {
    const hospitalId = hospitalFilterOf(scope);
    if (hospitalId === null) return;
    if (!(await this.employedAt(doctorId, hospitalId))) {
      throw AppException.notFound('Doctor not found');
    }
  }

  /** For `POST /doctors/:doctorId/employments` (see the class comment). */
  async assertCanStart(
    scope: ResolvedAdminScope,
    doctorId: string,
    hospitalPublicId: string,
  ): Promise<void> {
    const hospitalId = hospitalFilterOf(scope);
    if (hospitalId === null) return;

    const hospital = await this.prisma.db.hospital.findFirst({
      where: { publicId: hospitalPublicId },
      select: { id: true },
    });
    if (hospital === null || hospital.id !== hospitalId) {
      throw AppException.notFound('Hospital not found');
    }

    if (!UUID.test(doctorId)) throw AppException.notFound('Doctor not found');
    const elsewhere = await this.prisma.doctorEmployment.count({
      where: { doctorId, endedAt: null, hospitalId: { not: hospitalId } },
    });
    if (elsewhere > 0) throw AppException.notFound('Doctor not found');
  }

  /** For an employment route: 404 unless the employment is the caller's hospital's. */
  async assertEmployment(
    scope: ResolvedAdminScope,
    doctorId: string,
    employmentId: string,
  ): Promise<void> {
    const hospitalId = hospitalFilterOf(scope);
    if (hospitalId === null) return;
    if (!UUID.test(doctorId) || !UUID.test(employmentId)) {
      throw AppException.notFound('Employment not found');
    }
    const owned = await this.prisma.doctorEmployment.count({
      where: { id: employmentId, doctorId, hospitalId },
    });
    if (owned === 0) throw AppException.notFound('Employment not found');
  }

  private async employedAt(doctorId: string, hospitalId: string): Promise<boolean> {
    if (!UUID.test(doctorId)) return false;
    const count = await this.prisma.doctorEmployment.count({
      where: { doctorId, hospitalId, endedAt: null },
    });
    return count > 0;
  }
}
