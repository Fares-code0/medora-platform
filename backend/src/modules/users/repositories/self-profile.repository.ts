/**
 * The caller's own account, clinical record and professional profile
 * (ADR-030, ADR-036 — API §2.1, §3.1).
 *
 * One query, keyed by `users.id`, pulling both optional satellites
 * through their relations. There is no `patientId` or `doctorId`
 * parameter anywhere in this file, and that is the design: the subject
 * of a `/me` route is the token, so there is no identifier a caller
 * could substitute.
 *
 * `select` is explicit and never spread, for the reason every projection
 * in this codebase gives — a column added to `users`, `patients` or
 * `doctors` tomorrow must not appear in a profile response by default.
 * The `doctors` selection in particular leaves out `employee_id`, the
 * emergency contact and the audit columns: a practitioner's own settings
 * screen edits none of them, and a field on the wire is a field in a log.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROFILE_SELECT = {
  publicId: true,
  firstName: true,
  lastName: true,
  displayName: true,
  email: true,
  phone: true,
  emailVerifiedAt: true,
  twoFactorEnabled: true,
  avatarUrl: true,
  patient: {
    select: {
      publicId: true,
      fullName: true,
      dateOfBirth: true,
      gender: true,
      bloodType: true,
      phone: true,
      email: true,
      address: true,
      photoUrl: true,
      registeredAt: true,
      lastVisitAt: true,
    },
  },
  doctor: {
    select: {
      id: true,
      fullName: true,
      title: true,
      specialty: true,
      licenseNumber: true,
      licenseExpiresOn: true,
      professionalCategory: true,
      yearsOfExperience: true,
      biography: true,
      languages: true,
      education: true,
      certifications: true,
      skills: true,
      contactEmail: true,
      contactPhone: true,
      officeLocation: true,
      officeHours: true,
      linkedinUrl: true,
      websiteUrl: true,
      photoUrl: true,
      verificationStatus: true,
      verifiedAt: true,
      practiceStatus: true,
      ratingAvg: true,
      department: { select: { name: true } },
    },
  },
} as const;

export type SelfProfileRow = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;

/** The subset of `doctors` columns `PATCH /me/profile` may write. */
export interface DoctorProfilePatch {
  readonly fullName?: string | undefined;
  readonly title?: string | null | undefined;
  readonly specialty?: string | undefined;
  readonly licenseNumber?: string | undefined;
  readonly licenseExpiresOn?: Date | null | undefined;
  readonly yearsOfExperience?: number | undefined;
  readonly biography?: string | null | undefined;
  readonly languages?: readonly string[] | undefined;
  readonly education?: readonly string[] | undefined;
  readonly certifications?: readonly string[] | undefined;
  readonly skills?: readonly string[] | undefined;
  readonly contactEmail?: string | undefined;
  readonly contactPhone?: string | undefined;
  readonly officeLocation?: string | null | undefined;
  readonly officeHours?: string | null | undefined;
  readonly linkedinUrl?: string | null | undefined;
  readonly websiteUrl?: string | null | undefined;
}

@Injectable()
export class SelfProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfile(userId: string): Promise<SelfProfileRow | null> {
    // A non-uuid subject answers `null` rather than raising a Postgres
    // type error — the same guard every repository here carries, and for
    // the same reason: `AuthenticatedUser` deliberately holds two ids.
    if (!UUID.test(userId)) return null;

    return this.prisma.db.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
  }

  /** The caller's `doctors` row id, or null when they are not one. */
  async doctorIdForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    const doctor = await this.prisma.db.doctor.findUnique({
      where: { userId },
      select: { id: true },
    });

    return doctor?.id ?? null;
  }

  /**
   * Applies the patch, and re-opens verification in the same statement
   * when it has to (API §3.2).
   *
   * One `update` rather than two: a licence edit that landed while the
   * status reset did not would leave a practitioner **verified against a
   * number they no longer hold**, which is the precise state the
   * re-verification rule exists to prevent. Making it one statement makes
   * that state unreachable rather than unlikely.
   */
  async updateDoctorProfile(input: {
    readonly doctorId: string;
    readonly actorId: string;
    readonly patch: DoctorProfilePatch;
    readonly reopenVerification: boolean;
  }): Promise<void> {
    const data: Prisma.DoctorUpdateInput = {
      ...(input.patch.fullName === undefined ? {} : { fullName: input.patch.fullName }),
      ...(input.patch.title === undefined ? {} : { title: input.patch.title }),
      ...(input.patch.specialty === undefined ? {} : { specialty: input.patch.specialty }),
      ...(input.patch.licenseNumber === undefined
        ? {}
        : { licenseNumber: input.patch.licenseNumber }),
      ...(input.patch.licenseExpiresOn === undefined
        ? {}
        : { licenseExpiresOn: input.patch.licenseExpiresOn }),
      ...(input.patch.yearsOfExperience === undefined
        ? {}
        : { yearsOfExperience: input.patch.yearsOfExperience }),
      ...(input.patch.biography === undefined ? {} : { biography: input.patch.biography }),
      ...(input.patch.languages === undefined ? {} : { languages: [...input.patch.languages] }),
      ...(input.patch.education === undefined ? {} : { education: [...input.patch.education] }),
      ...(input.patch.certifications === undefined
        ? {}
        : { certifications: [...input.patch.certifications] }),
      ...(input.patch.skills === undefined ? {} : { skills: [...input.patch.skills] }),
      ...(input.patch.contactEmail === undefined ? {} : { contactEmail: input.patch.contactEmail }),
      ...(input.patch.contactPhone === undefined ? {} : { contactPhone: input.patch.contactPhone }),
      ...(input.patch.officeLocation === undefined
        ? {}
        : { officeLocation: input.patch.officeLocation }),
      ...(input.patch.officeHours === undefined ? {} : { officeHours: input.patch.officeHours }),
      ...(input.patch.linkedinUrl === undefined ? {} : { linkedinUrl: input.patch.linkedinUrl }),
      ...(input.patch.websiteUrl === undefined ? {} : { websiteUrl: input.patch.websiteUrl }),
      ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
      ...(input.reopenVerification
        ? {
            verificationStatus: 'PENDING',
            // Cleared with the status: a `verified_at` left beside
            // `pending` would read as a verification that is still good.
            verifiedAt: null,
          }
        : {}),
    };

    await this.prisma.db.doctor.update({ where: { id: input.doctorId }, data });
  }

  /**
   * Points the professional profile at a stored photo.
   *
   * `doctors.photo_url` holds the **`files.id`** of the photo, never a
   * URL: a signed URL expires within a minute, so a stored one would be
   * dead by the next read. Every view that carries the photo resolves the
   * id to a fresh signed URL through `shared/files`' `ProfilePhotoUrls`.
   *
   * A `files` row rather than the bare storage key, for two reasons. The
   * malware scanner (M30.2) sweeps `files` rows, so an object with no row
   * is never scanned and could never pass the M25.3 gate. And the row is
   * looked up by primary key — `files.storage_key` carries no index.
   *
   * One transaction: the row, the pointer, and the soft delete of the
   * photo it replaces land together. The replaced row's object is then
   * M25.5's sweep to collect, exactly as for any other deleted file.
   */
  async setDoctorPhoto(input: {
    readonly doctorId: string;
    readonly actorId: string;
    readonly storageKey: string;
    readonly name: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly checksumSha256: string;
  }): Promise<{ readonly fileId: string }> {
    const actor = UUID.test(input.actorId) ? input.actorId : null;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.doctor.findUniqueOrThrow({
        where: { id: input.doctorId },
        select: { photoUrl: true },
      });

      const file = await tx.file.create({
        data: {
          storageKey: input.storageKey,
          originalName: input.name,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          checksumSha256: input.checksumSha256,
          kind: 'profile_photo',
          ...(actor === null ? {} : { uploadedBy: actor }),
        },
        select: { id: true },
      });

      await tx.doctor.update({
        where: { id: input.doctorId },
        data: { photoUrl: file.id, ...(actor === null ? {} : { updatedBy: actor }) },
      });

      if (current.photoUrl !== null && UUID.test(current.photoUrl)) {
        await tx.file.updateMany({
          where: { id: current.photoUrl, kind: 'profile_photo', deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }

      return { fileId: file.id };
    });
  }

  /**
   * Every active administrator's user id — who a re-opened verification
   * notifies (API §3.2).
   *
   * By capability rather than by role code would be better and is not
   * available here: `roles.manage` is resolved by the authz kernel, and
   * the notification only has to reach the people who work the
   * verification queue. `admin` is the role that holds `doctors.verify`
   * in the seeded matrix, and M19's routing rules are where a per-user
   * subscription belongs.
   */
  async administratorUserIds(): Promise<readonly string[]> {
    const rows = await this.prisma.db.user.findMany({
      where: { role: { code: 'admin' }, status: 'ACTIVE' },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }
}
