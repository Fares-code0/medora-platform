/**
 * Reads and writes over `doctor_employments` for the administrator's
 * employment lifecycle (OD-12, gap G3, stage S6 — GitHub #54).
 *
 * ## Ending an employment is one transaction
 *
 * OD-12 (FINAL) is "employment end revokes hospital access immediately,
 * with no grace period". `end()` therefore does every part of that in a
 * single transaction, so a failure anywhere leaves the employment active
 * and nothing half-revoked:
 *
 * 1. `ended_at` is set **only if still active** — a conditional update, so
 *    two concurrent ends serialize on the row and exactly one wins;
 * 2. live care assignments owned by this employment
 *    (`patient_doctor_assignments.doctor_employment_id`) are revoked;
 * 3. every live session of the doctor's account is revoked;
 * 4. the audit row is inserted by the caller's callback on the same
 *    transaction (`TransactionalAuditWriter`), so the end and its record
 *    commit together or not at all.
 *
 * ## Why the session revocation is written here and not by `SessionService`
 *
 * `SessionService.revokeAllFor(userId, tx)` is the mechanism, and the
 * write below is its write, column for column (`revokedAt`, `rotatedAt:
 * null`, `successorTokenCt: null`). It is not *called* because RM M2.2's
 * zone 1 (`eslint.config.mjs`, `import/no-restricted-paths`) forbids a
 * module importing a sibling, and `AuthModule` exports nothing by design.
 * The precedent is `PlatformUserRepository.revokeSessions`. The effect is
 * the same one: the access-token guard reads session state from the
 * database on every request, so the committed `revoked_at` refuses the
 * doctor's next request (401) and their refresh token.
 * `doctor-employment.repository.spec.ts` holds the two writes equal, so
 * a change to `revokeAllFor` that this copy missed fails a test.
 *
 * ## Legacy assignments are not touched (issue #17)
 *
 * An assignment with `doctor_employment_id IS NULL` predates the
 * multi-hospital model and belongs to no employment. Which hospital — if
 * any — it should be attributed to is an open owner decision (#17), so it
 * is left exactly as it is and only **counted**, for the audit row.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPLOYMENT_SELECT = {
  id: true,
  doctorId: true,
  hospitalId: true,
  hospitalDepartmentId: true,
  startedAt: true,
  endedAt: true,
  hospital: { select: { publicId: true, name: true } },
  department: { select: { id: true, name: true } },
} as const;

export type EmploymentRow = Prisma.DoctorEmploymentGetPayload<{
  select: typeof EMPLOYMENT_SELECT;
}>;

export interface EmploymentHospitalRow {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
  readonly status: string;
}

/** Runs on the write's own transaction; throwing rolls the write back. */
export type WithinTransaction<T> = (tx: Prisma.TransactionClient, row: T) => Promise<void>;

export interface EndedEmployment {
  readonly employment: EmploymentRow;
  readonly userId: string;
  readonly revokedAssignments: number;
  readonly revokedSessions: number;
  /** Live assignments with no employment (#17) — counted, not changed. */
  readonly legacyAssignmentsUntouched: number;
}

export type EndOutcome =
  | ({ readonly kind: 'ended' } & EndedEmployment)
  | { readonly kind: 'not_found' }
  | { readonly kind: 'already_ended' };

@Injectable()
export class DoctorEmploymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The doctor, unless unknown or soft-deleted.
   *
   * `findFirst`, not `findUnique`: the soft-delete extension cannot filter
   * `findUnique` (`shared/database/soft-delete.ts`), so a by-id lookup
   * would return a soft-deleted doctor.
   */
  findDoctor(doctorId: string): Promise<{ id: string; userId: string } | null> {
    if (!UUID.test(doctorId)) return Promise.resolve(null);

    return this.prisma.db.doctor.findFirst({
      where: { id: doctorId },
      select: { id: true, userId: true },
    });
  }

  /** By public id, unless unknown or soft-deleted (`findFirst`, as above). Any status. */
  findHospital(publicId: string): Promise<EmploymentHospitalRow | null> {
    return this.prisma.db.hospital.findFirst({
      where: { publicId },
      select: { id: true, publicId: true, name: true, status: true },
    });
  }

  /** The department only if it belongs to `hospitalId` and is not soft-deleted. */
  findDepartment(hospitalId: string, departmentId: string): Promise<{ id: string } | null> {
    return this.prisma.db.hospitalDepartment.findFirst({
      where: { id: departmentId, hospitalId },
      select: { id: true },
    });
  }

  /**
   * Every employment of a doctor, newest first.
   *
   * The base client, not `db`: history must still name a hospital or a
   * department that was soft-deleted after the employment, and the
   * soft-delete extension would null those nested relations.
   */
  listFor(doctorId: string): Promise<EmploymentRow[]> {
    return this.prisma.doctorEmployment.findMany({
      where: { doctorId },
      select: EMPLOYMENT_SELECT,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Inserts the employment and runs `within` (the audit row) on the same
   * transaction.
   *
   * A second active employment is refused by the partial unique index
   * `doctor_employments_one_active_per_doctor_key` (DR-02) with P2002,
   * which the service maps to 409 — the database, not a read-then-write,
   * is what makes the rule hold under concurrency.
   */
  start(
    input: { doctorId: string; hospitalId: string; hospitalDepartmentId: string | null },
    within: WithinTransaction<EmploymentRow>,
  ): Promise<EmploymentRow> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.doctorEmployment.create({
        data: {
          doctorId: input.doctorId,
          hospitalId: input.hospitalId,
          ...(input.hospitalDepartmentId === null
            ? {}
            : { hospitalDepartmentId: input.hospitalDepartmentId }),
        },
        select: EMPLOYMENT_SELECT,
      });
      await within(tx, row);
      return row;
    });
  }

  /** See the file header: one transaction, OD-12's immediate invalidation. */
  async end(
    doctorId: string,
    employmentId: string,
    within: WithinTransaction<EndedEmployment>,
  ): Promise<EndOutcome> {
    if (!UUID.test(doctorId) || !UUID.test(employmentId)) return { kind: 'not_found' };

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // 1. Conditional: a concurrent end waits on this row lock, then
      //    re-reads `ended_at` and matches nothing.
      const ended = await tx.doctorEmployment.updateMany({
        where: { id: employmentId, doctorId, endedAt: null },
        data: { endedAt: now },
      });

      if (ended.count === 0) {
        const exists = await tx.doctorEmployment.findFirst({
          where: { id: employmentId, doctorId },
          select: { id: true },
        });
        return exists === null ? { kind: 'not_found' } : { kind: 'already_ended' };
      }

      const employment = await tx.doctorEmployment.findUniqueOrThrow({
        where: { id: employmentId },
        select: EMPLOYMENT_SELECT,
      });
      const { userId } = await tx.doctor.findUniqueOrThrow({
        where: { id: doctorId },
        select: { userId: true },
      });

      // 2. Care assignments this employment owns. Legacy rows (no
      //    employment, #17) are deliberately outside this `where`.
      const assignments = await tx.patientDoctorAssignment.updateMany({
        where: { doctorEmploymentId: employmentId, revokedAt: null },
        data: { revokedAt: now },
      });
      const legacyAssignmentsUntouched = await tx.patientDoctorAssignment.count({
        where: { doctorId, doctorEmploymentId: null, revokedAt: null },
      });

      // 3. Every live session — `SessionService.revokeAllFor`'s write.
      const sessions = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), rotatedAt: null, successorTokenCt: null },
      });

      const result: EndedEmployment = {
        employment,
        userId,
        revokedAssignments: assignments.count,
        revokedSessions: sessions.count,
        legacyAssignmentsUntouched,
      };

      // 4. The audit row, on this transaction.
      await within(tx, result);

      return { kind: 'ended', ...result };
    });
  }
}
