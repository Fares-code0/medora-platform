/**
 * The caller's own account row, and the activity feed over it
 * (RM M8.1, M8.6 — DB §A4, §A6, §A12).
 *
 * `select` is explicit and never spread, for the reason
 * `PatientProfileRepository` states: a column added to `users` tomorrow
 * must not appear in an account response by default. `user_credentials`
 * is reached through the relation for exactly one field —
 * `password_updated_at` — and the hash, the TOTP secret and the lockout
 * counter are never selected. The two tables are separate precisely so
 * that stays true (DB §A6).
 */

import { Injectable } from '@nestjs/common';

import type { ActivityKind } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccountRow {
  readonly email: string;
  readonly username: string | null;
  readonly phone: string;
  readonly emailVerifiedAt: Date | null;
  readonly twoFactorEnabled: boolean;
  readonly credentials: { readonly passwordUpdatedAt: Date } | null;
}

export interface ActivityRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly kind: ActivityKind;
  readonly summary: string;
  readonly detail: string | null;
}

@Injectable()
export class AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccount(userId: string): Promise<AccountRow | null> {
    if (!UUID.test(userId)) return null;

    return this.prisma.db.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        username: true,
        phone: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
        credentials: { select: { passwordUpdatedAt: true } },
      },
    });
  }

  /**
   * Whether a username is already claimed by **another** account.
   *
   * A pre-check for the contract's 409; `users.username` is UNIQUE, and
   * that constraint — not this query — is what makes it correct when two
   * claims for one name arrive together. Both are needed, exactly as
   * they are for `users.email` (see `IdentityRepository`).
   *
   * `findFirst` rather than `findUnique` so the soft-delete extension
   * applies: a deactivated account still holds its username in the
   * index, so this answering `false` for one means the update below
   * fails on the constraint and the caller answers 409 anyway.
   */
  async usernameTaken(username: string, exceptUserId: string): Promise<boolean> {
    const existing = await this.prisma.db.user.findFirst({
      where: { username, ...(UUID.test(exceptUserId) ? { id: { not: exceptUserId } } : {}) },
      select: { id: true },
    });

    return existing !== null;
  }

  /** Applies the account patch and returns the row as it now stands. */
  async updateAccount(
    userId: string,
    data: { readonly username?: string | undefined; readonly phone?: string | undefined },
  ): Promise<AccountRow> {
    return this.prisma.db.user.update({
      where: { id: userId },
      data: {
        ...(data.username === undefined ? {} : { username: data.username }),
        ...(data.phone === undefined ? {} : { phone: data.phone }),
        // `updated_by` is the actor, and on a self-service route the
        // actor *is* the subject. Stated rather than left null so the
        // audit columns read the same as they will when an
        // administrator edits the row at §2.10.
        updatedBy: userId,
      },
      select: {
        email: true,
        username: true,
        phone: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
        credentials: { select: { passwordUpdatedAt: true } },
      },
    });
  }

  /**
   * A page of the caller's own activity, newest first.
   *
   * `@@index([userId, occurredAt(sort: Desc)])` is exactly this query.
   */
  async activity(
    userId: string,
    criteria: { readonly kind?: ActivityKind | undefined; page: number; pageSize: number },
  ): Promise<{ rows: readonly ActivityRow[]; totalItems: number }> {
    if (!UUID.test(userId)) return { rows: [], totalItems: 0 };

    const where = { userId, ...(criteria.kind === undefined ? {} : { kind: criteria.kind }) };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.userActivityLog.findMany({
        where,
        select: { id: true, occurredAt: true, kind: true, summary: true, detail: true },
        orderBy: { occurredAt: 'desc' },
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.userActivityLog.count({ where }),
    ]);

    return { rows, totalItems };
  }
}
