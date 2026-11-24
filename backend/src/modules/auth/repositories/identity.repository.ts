import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import type { Prisma, User } from '../../../generated/prisma/client';

/**
 * Every read and write the auth flows make against the identity tables
 * (RM M6.1–M6.5, DB §A4–A12).
 *
 * One repository rather than one per table: `users`, `user_credentials`,
 * `sessions`, `verification_tokens` and `otp_codes` are not five
 * aggregates, they are one — the credential row's primary key *is* the
 * user's, and a session without its user is meaningless. Splitting them
 * would put a transaction boundary in the middle of an aggregate, which
 * is where lost-update bugs come from.
 *
 * Services above hold the policy; this file holds the queries.
 */

/** The joined shape the login and refresh paths need in one round trip. */
export type UserWithCredentials = Prisma.UserGetPayload<{
  include: { credentials: true; role: true };
}>;

@Injectable()
export class IdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `findFirst` and not `findUnique`, which is the whole point.
   *
   * The soft-delete extension cannot filter `findUnique`: its `where`
   * accepts only unique fields, so `deletedAt` is rejected by both the
   * types and the runtime (`shared/database/soft-delete.ts` says so).
   * A `findUnique` here would therefore return a **deactivated account**
   * — and M8.2 deactivates by soft delete, so that account would still
   * be able to sign in. `findFirst` on a unique column costs the same
   * index lookup and is filtered.
   *
   * citext (DB §A4): `Doctor@…` and `doctor@…` are one account.
   */
  findByEmail(email: string): Promise<UserWithCredentials | null> {
    return this.prisma.db.user.findFirst({
      where: { email },
      include: { credentials: true, role: true },
    });
  }

  /** Same reasoning as `findByEmail` — a refresh must not outlive an account. */
  findById(id: string): Promise<UserWithCredentials | null> {
    return this.prisma.db.user.findFirst({
      where: { id },
      include: { credentials: true, role: true },
    });
  }

  /**
   * Whether `userId` is a doctor whose employment has ended (#18,
   * OWNER_DECISIONS 2026-11-23: "Employment terminated — login denied").
   *
   * Terminated means: a `doctors` row with **at least one**
   * `doctor_employments` row and **no active one** (`ended_at IS NULL`).
   * A doctor with no employment rows at all is a legacy account not yet
   * mapped to a hospital; it is not terminated and keeps its sign-in (the
   * hospital-aware authorization gives it no clinical access). Not a
   * doctor: `false`.
   *
   * The unfiltered client, so a soft-deleted `doctors` row still counts —
   * its employments say what they say. One indexed read.
   */
  async isTerminatedDoctor(userId: string): Promise<boolean> {
    const doctor = await this.prisma.doctor.findFirst({
      where: {
        userId,
        AND: [{ employments: { some: {} } }, { employments: { none: { endedAt: null } } }],
      },
      select: { id: true },
    });
    return doctor !== null;
  }

  /**
   * Creates the account and its credential row in one transaction.
   *
   * The two are inseparable: a `users` row with no `user_credentials` is
   * an account nobody can ever sign in to and nothing would report,
   * because every read path treats a missing credential row as "no
   * password set" rather than as corruption.
   */
  createAccount(input: {
    readonly publicId: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly displayName: string;
    readonly email: string;
    readonly phone: string;
    readonly roleId: string;
    readonly licenseNumber?: string | undefined;
    readonly passwordHash: string;
    readonly consentedAt: Date;
    /**
     * The professional profile to create alongside the account, for a
     * doctor registration (ADR-035 §4).
     *
     * In the same transaction as the account and not a follow-up write:
     * a `users` row holding the doctor role with no `doctors` row is an
     * account the verification queue cannot see, which is precisely the
     * state that made professional verification unreachable before
     * ADR-035. Either both rows exist or neither does.
     */
    readonly doctorProfile?:
      | {
          readonly fullName: string;
          readonly specialty: string;
          readonly licenseNumber: string;
          readonly professionalCategory: string;
          readonly licenseExpiresOn?: Date | undefined;
          readonly contactEmail: string;
          readonly contactPhone: string;
        }
      | undefined;
  }): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          publicId: input.publicId,
          firstName: input.firstName,
          lastName: input.lastName,
          displayName: input.displayName,
          email: input.email,
          phone: input.phone,
          roleId: input.roleId,
          ...(input.licenseNumber === undefined ? {} : { licenseNumber: input.licenseNumber }),
          // Both consents are recorded at the same instant because the
          // form collects them in one submission (API §1.1). Two columns
          // rather than one flag: MG §11.8 needs to answer "which policy
          // version, and when" per document, not per signup.
          termsAcceptedAt: input.consentedAt,
          privacyAcceptedAt: input.consentedAt,
        },
      });

      await tx.userCredential.create({
        data: { userId: user.id, passwordHash: input.passwordHash },
      });

      if (input.doctorProfile !== undefined) {
        await tx.doctor.create({
          data: {
            userId: user.id,
            fullName: input.doctorProfile.fullName,
            specialty: input.doctorProfile.specialty,
            licenseNumber: input.doctorProfile.licenseNumber,
            professionalCategory: input.doctorProfile.professionalCategory,
            ...(input.doctorProfile.licenseExpiresOn === undefined
              ? {}
              : { licenseExpiresOn: input.doctorProfile.licenseExpiresOn }),
            contactEmail: input.doctorProfile.contactEmail,
            contactPhone: input.doctorProfile.contactPhone,
            // The column default, stated rather than relied on: PENDING is
            // the honest answer to "has this registration number been
            // checked against a register", and this is the line that would
            // have to change for the platform to start claiming otherwise.
            verificationStatus: 'PENDING',
          },
        });
      }

      return user;
    });
  }

  /**
   * Whether a professional registration number is already on a
   * `doctors` row (ADR-035 §4).
   *
   * A pre-check for the contract's 409; `doctors.license_number` is
   * UNIQUE, and that constraint — not this query — is what makes it
   * correct when two registrations for one number arrive together. Both
   * are needed, exactly as they are for `users.email`.
   *
   * `findFirst` and not `findUnique` for the reason `findByEmail`
   * documents: the soft-delete extension cannot filter `findUnique`.
   * Here the effect is the opposite of that one and is deliberate — a
   * soft-deleted doctor still holds the number in the unique index, so
   * this returning `false` for one means the insert below fails on the
   * constraint and the caller answers 409 anyway.
   */
  async professionalNumberTaken(licenseNumber: string): Promise<boolean> {
    const existing = await this.prisma.db.doctor.findFirst({
      where: { licenseNumber },
      select: { id: true },
    });

    return existing !== null;
  }

  findRoleByCode(code: string): Promise<{ id: string; code: string } | null> {
    return this.prisma.db.role.findUnique({
      where: { code },
      select: { id: true, code: true },
    });
  }

  markEmailVerified(userId: string): Promise<void> {
    return this.prisma.db.user
      .update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } })
      .then(() => undefined);
  }

  /**
   * A client-facing id in the `usr_…` shape the frontend already shows
   * (`usr_doctor_amelia`).
   *
   * Random rather than sequential: `usr_1`, `usr_2` would tell anyone
   * holding one id how many accounts exist and let them guess the
   * others. 12 bytes of base64url is 96 bits, which is not going to
   * collide, but the unique index on `public_id` is what actually
   * guarantees it rather than the arithmetic.
   */
  static generatePublicId(): string {
    return `usr_${randomBytes(12).toString('base64url')}`;
  }
}
