/**
 * `PATIENT_SELF_REPOSITORY` against `patients.user_id` (ADR-030).
 *
 * One question, one column, one index. `patients.user_id` is unique, so
 * `findUnique` is the whole implementation and the lookup is an index hit
 * on a path that runs before every `/me/*` read.
 *
 * ## Why `publicId` and not the uuid
 *
 * Every route quotes the public `PT-…` handle, and returning the surrogate
 * key here would push a second lookup into every caller — or, worse, leak
 * the uuid into a response that has always spoken `PT-…`.
 *
 * ## Soft delete is the client extension's job, not this file's
 *
 * `patients` is soft-deleted throughout (DB §7), and M4.2's Prisma client
 * extension filters `deleted_at` globally. Repeating the predicate here
 * would be a second place for the rule to drift out of agreement with
 * itself.
 *
 * ## A non-uuid subject answers `null`, not 500
 *
 * The same guard `PrismaPatientAssignmentRepository` carries, for the
 * same reason: Postgres rejects a malformed uuid literal with a **type
 * error**, not with an empty result. `Principal.userId` is `users.id` —
 * the uuid — but `AuthenticatedUser` deliberately carries two ids, and
 * the `usr_…` public one is what every response and audit row quotes. A
 * caller that passes the wrong one of the two should get the honest
 * answer "this account owns no patient record" rather than a 500 on a
 * path that runs before every `/me/*` read.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database';
import type { PatientSelfRepository } from './authz.types';

@Injectable()
export class PrismaPatientSelfRepository implements PatientSelfRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPatientIdByUserId(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    // `findFirst` with `deletedAt: null`, not `findUnique`: the soft-delete
    // extension filters only the former, and a deactivated chart must not
    // be the account's self scope.
    const patient = await this.prisma.db.patient.findFirst({
      where: { userId, deletedAt: null },
      select: { publicId: true },
    });

    return patient?.publicId ?? null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
