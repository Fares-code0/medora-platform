/**
 * The caller's own profile (ADR-036 — API §2.1, §3.1, §3.2, §3.3).
 *
 * ## An unlinked or non-professional account is a 200, not a 404
 *
 * The decision this service inherited from ADR-030 and now makes twice.
 * A patient who registered ten seconds ago has an account and no
 * clinical record; an administrator has an account and no professional
 * profile. Both are **normal**, so both answer `200` with that half
 * `null` and the client renders accordingly.
 *
 * Answering 404 instead would be worse than merely unhelpful: it would
 * make an ordinary state indistinguishable from a broken session, and a
 * client's natural response to a 404 on its own profile is to log the
 * user out.
 *
 * ## `PATCH` edits the professional profile, and only that
 *
 * API §3.2 is the doctor profile document. A **patient's** profile edit
 * is a different question with a different answer — which fields a
 * patient may change, and who wins when a clinician edits the same field
 * — and ADR-030 RA-030.2 leaves it deliberately open. Guessing it would
 * encode a data-ownership policy in a route, so a caller with no
 * `doctors` row gets 404 from `PATCH` even though `GET` serves them
 * happily. The asymmetry is the honest one: there is a document to read
 * and no decision about writing it.
 *
 * ## A licence edit re-opens verification, and that is not optional
 *
 * API §3.2: "license-field edits ⇒ `verificationStatus:'pending'` +
 * admin notification (audited)". A practitioner who could change the
 * number the clinic verified, and keep the verified badge, would make
 * the whole of M9.3 decorative. The reset happens in the **same
 * statement** as the edit (see the repository), so "verified against a
 * number no longer on the row" is unreachable rather than unlikely.
 */

import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import {
  checkSignature,
  FILE_STORAGE,
  type FileStoragePort,
  ProfilePhotoUrls,
} from '../../../shared/files';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import { isUniqueViolation } from '../../../shared/database';
import { bloodTypeToWire, genderToWire } from '../dto/clinical-enums';
import {
  ageOn,
  type DoctorProfileView,
  type SelfProfileView,
} from '../dto/self-profile.dto';
import {
  LICENSE_FIELDS,
  type UpdateDoctorProfileInput,
} from '../dto/self-profile.schema';
import {
  SelfProfileRepository,
  type DoctorProfilePatch,
  type SelfProfileRow,
} from '../repositories/self-profile.repository';

/** Per-kind rules for the profile photo (API §17.1, M25.1 generalises them). */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class SelfProfileService {
  constructor(
    private readonly profiles: SelfProfileRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    private readonly photos: ProfilePhotoUrls,
  ) {}

  /** API §2.1 / §3.1 — the composed document. */
  async profile(userId: string): Promise<SelfProfileView> {
    const row = await this.profiles.findProfile(userId);

    // The token was valid, so the account existed when it was minted.
    // Reaching here means the row has since gone — a deactivated or
    // deleted account presenting a still-valid access token. 404 rather
    // than 500: the resource genuinely is not there.
    if (row === null) throw AppException.notFound('Account not found');

    return this.view(row);
  }

  /** API §3.2 — edit the professional profile. */
  async updateDoctorProfile(
    user: AuthenticatedUser,
    input: UpdateDoctorProfileInput,
  ): Promise<SelfProfileView> {
    const doctorId = await this.profiles.doctorIdForUser(user.id);
    if (doctorId === null) throw noDoctorProfile();

    const current = await this.profiles.findProfile(user.id);
    if (current === null || current.doctor === null) throw noDoctorProfile();

    const reopenVerification = licenceFieldsChanged(input, current.doctor);

    try {
      await this.profiles.updateDoctorProfile({
        doctorId,
        actorId: user.id,
        patch: toPatch(input),
        reopenVerification,
      });
    } catch (error) {
      // `doctors.license_number` is UNIQUE — a registration number
      // identifies one practitioner. Two doctors claiming one number is a
      // 409 rather than a 500, and it is the constraint rather than a
      // pre-check that makes the answer correct under a race.
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'That professional registration number is already on another practitioner',
          'professional_number_taken',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'doctor.profile_update',
      actor: { userId: user.id, role: user.role },
      entityType: 'doctor',
      entityId: doctorId,
      metadata: {
        fields: Object.keys(input).sort().join(','),
        // The fact of the reset, not the number. A registration number in
        // the ledger is a professional identifier that an audit row has
        // no reason to carry.
        verificationReopened: reopenVerification,
      },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'profile',
      summary: reopenVerification
        ? 'Professional registration updated; verification re-opened'
        : 'Professional profile updated',
    });

    if (reopenVerification) await this.notifyAdministrators(doctorId);

    const saved = await this.profiles.findProfile(user.id);
    if (saved === null) throw AppException.notFound('Account not found');

    return this.view(saved);
  }

  /**
   * API §3.3 — the profile photo.
   *
   * **Answers 503 today, by design.** `FILE_STORAGE` is still
   * `UnconfiguredFileStorage` until M25.2 wires the S3 adapter, and that
   * stub rejects rather than resolving — "a `put()` that resolved
   * without writing anything would hand the caller a file id for bytes
   * that do not exist". The route is real, the validation is real, and
   * the adapter is the part that is absent; M9.2 anticipated exactly
   * this ("stub storage acceptable until M25; same interface").
   *
   * The type and size checks run **before** the storage call, so they
   * are the answer a client gets today rather than being masked by the
   * 503 — and they are the checks M25.1 generalises rather than replaces.
   *
   * The response's `doctor.photoUrl` is **null until the scan clears**:
   * the upload writes a `files` row with no `scan_result`, and the view
   * serves a signed URL only once the M30.2 scanner marks it `clean`.
   */
  async updatePhoto(
    user: AuthenticatedUser,
    file: { readonly originalname: string; readonly mimetype: string; readonly buffer: Buffer },
  ): Promise<SelfProfileView> {
    const doctorId = await this.profiles.doctorIdForUser(user.id);
    if (doctorId === null) throw noDoctorProfile();

    if (!PHOTO_MIME_TYPES.includes(file.mimetype)) {
      throw AppException.validation(
        { photo: [`Use one of ${PHOTO_MIME_TYPES.join(', ')}`] },
        'Unsupported image type',
      );
    }

    if (file.buffer.byteLength > PHOTO_MAX_BYTES) {
      throw AppException.validation(
        { photo: ['Keep the image under 5 MB'] },
        'Image too large',
      );
    }

    // The declared type is the client's word; this checks the bytes are
    // that type too (`shared/files/file-signature.ts`).
    const mismatch = checkSignature(file.mimetype, file.buffer, 'photo');
    if (mismatch !== null) {
      throw AppException.validation({ photo: [mismatch.message] }, 'Unsupported image type');
    }

    const stored = await this.storage.put({
      kind: 'profile_photo',
      name: file.originalname,
      mimeType: file.mimetype,
      content: file.buffer,
    });

    // The key, through a `files` row, and never a URL — see the
    // repository. The checksum is computed over the bytes that arrived,
    // as `files.service` does.
    const { fileId } = await this.profiles.setDoctorPhoto({
      doctorId,
      actorId: user.id,
      storageKey: stored.key,
      name: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.byteLength,
      checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
    });

    await this.audit.record({
      action: 'doctor.photo_update',
      actor: { userId: user.id, role: user.role },
      entityType: 'doctor',
      entityId: doctorId,
      metadata: { fileId, sizeBytes: stored.sizeBytes },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'profile',
      summary: 'Profile photo updated',
    });

    const saved = await this.profiles.findProfile(user.id);
    if (saved === null) throw AppException.notFound('Account not found');

    return this.view(saved);
  }

  /**
   * The wire document, with the stored photo resolved to a loadable URL.
   *
   * `doctors.photo_url` holds a `files.id`; `ProfilePhotoUrls` turns it
   * into a short-TTL signed URL behind the M25.3 scan gate, or `null`
   * (see that class for every case). The same resolver serves the patient
   * doctor directory and the doctor embedded in patient appointments.
   */
  private async view(row: SelfProfileRow): Promise<SelfProfileView> {
    const doctorPhotoUrl =
      row.doctor === null ? null : await this.photos.resolve(row.doctor.photoUrl);

    return toView(row, new Date(), doctorPhotoUrl);
  }

  /**
   * Tells the people who work the verification queue (API §3.2).
   *
   * Through the outbox rather than by calling the notifications module,
   * for the reason zone 1 states — and the payload carries identifiers
   * only (MG §11.6). One message per administrator so M19 can route each
   * to that person's channel preferences rather than fanning out from a
   * single message with a list in it.
   */
  private async notifyAdministrators(doctorId: string): Promise<void> {
    const administrators = await this.profiles.administratorUserIds();
    const minute = String(Math.floor(Date.now() / 60_000));

    for (const userId of administrators) {
      await this.outbox.publish({
        topic: 'doctor.verification_reopened',
        payload: { doctorId, userId },
        dedupeKey: `doctor.verification_reopened:${doctorId}:${userId}:${minute}`,
      });
    }
  }
}

/** 404 for a caller with no `doctors` row — the resource is not theirs to edit. */
function noDoctorProfile(): AppException {
  return AppException.notFound('No doctor profile for this account');
}

/**
 * Whether the patch actually moves a licence field.
 *
 * Compared against the stored value rather than merely present in the
 * body: a settings screen sends the whole document back, so "the client
 * mentioned `licenseNumber`" is true on every save and would re-open
 * verification every time someone edited their biography. A practitioner
 * whose verification reset on an unrelated edit would learn to stop
 * editing, which is the opposite of what a profile screen is for.
 */
function licenceFieldsChanged(
  input: UpdateDoctorProfileInput,
  current: NonNullable<SelfProfileRow['doctor']>,
): boolean {
  return LICENSE_FIELDS.some((field) => {
    if (field === 'licenseNumber') {
      return input.licenseNumber !== undefined && input.licenseNumber !== current.licenseNumber;
    }

    if (input.licenseExpiresOn === undefined) return false;

    const stored = current.licenseExpiresOn?.toISOString().slice(0, 10) ?? null;
    return input.licenseExpiresOn !== stored;
  });
}

function toPatch(input: UpdateDoctorProfileInput): DoctorProfilePatch {
  // `licenseExpiresOn` is pulled out rather than spread over: a `date`
  // column takes a `Date` and the wire carries `YYYY-MM-DD`, so
  // spreading the body and then overriding the field would leave the
  // string in the type even when the value is right.
  const { licenseExpiresOn, ...rest } = input;

  return {
    ...rest,
    ...(licenseExpiresOn === undefined
      ? {}
      : {
          // Parsed as UTC midnight so a server in a negative offset does
          // not store the day before.
          licenseExpiresOn:
            licenseExpiresOn === null ? null : new Date(`${licenseExpiresOn}T00:00:00Z`),
        }),
  };
}

function toView(row: SelfProfileRow, now: Date, doctorPhotoUrl: string | null): SelfProfileView {
  return {
    account: {
      id: row.publicId,
      firstName: row.firstName,
      lastName: row.lastName,
      displayName: row.displayName,
      email: row.email,
      phone: row.phone,
      // A timestamp, not a boolean, in the column: null means unverified.
      // The wire wants the question answered, not the evidence.
      emailVerified: row.emailVerifiedAt !== null,
      twoFactorEnabled: row.twoFactorEnabled,
      avatarUrl: row.avatarUrl,
    },
    patient:
      row.patient === null
        ? null
        : {
            id: row.patient.publicId,
            fullName: row.patient.fullName,
            // A `date` column: the time half is meaningless and a full
            // ISO timestamp would invite a client to apply its own zone
            // to a birthday and shift it by a day.
            dateOfBirth: row.patient.dateOfBirth.toISOString().slice(0, 10),
            age: ageOn(row.patient.dateOfBirth, now),
            gender: genderToWire(row.patient.gender),
            bloodType: bloodTypeToWire(row.patient.bloodType),
            phone: row.patient.phone,
            email: row.patient.email,
            address: row.patient.address,
            photoUrl: row.patient.photoUrl,
            registeredAt: row.patient.registeredAt.toISOString(),
            lastVisitAt: row.patient.lastVisitAt?.toISOString() ?? null,
          },
    doctor: row.doctor === null ? null : toDoctorView(row.doctor, doctorPhotoUrl),
  };
}

function toDoctorView(
  row: NonNullable<SelfProfileRow['doctor']>,
  photoUrl: string | null,
): DoctorProfileView {
  return {
    id: row.id,
    fullName: row.fullName,
    title: row.title,
    specialty: row.specialty,
    departmentName: row.department?.name ?? null,
    licenseNumber: row.licenseNumber,
    licenseExpiresOn: row.licenseExpiresOn?.toISOString().slice(0, 10) ?? null,
    professionalCategory: row.professionalCategory,
    yearsOfExperience: row.yearsOfExperience,
    biography: row.biography,
    languages: row.languages,
    education: row.education,
    certifications: row.certifications,
    skills: row.skills,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    officeLocation: row.officeLocation,
    officeHours: row.officeHours,
    linkedinUrl: row.linkedinUrl,
    websiteUrl: row.websiteUrl,
    photoUrl,
    verificationStatus: VERIFICATION_TO_WIRE[row.verificationStatus] ?? row.verificationStatus,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    practiceStatus: PRACTICE_TO_WIRE[row.practiceStatus] ?? row.practiceStatus,
    // `Decimal` would serialise as an object; the column is
    // `decimal(3,2)` so a float carries it exactly.
    ratingAvg: row.ratingAvg === null ? null : Number(row.ratingAvg),
  };
}

/**
 * ADR-023 §2 at this module's serialization boundary.
 *
 * `modules/doctors` has the same two maps and zone 1 forbids importing
 * them. Transcribed rather than `.toLowerCase()`d for the reason ADR-023
 * gives: `DOCS_REQUESTED` is `docs_requested` on the wire, which a
 * mechanical transform happens to get right and would get wrong the
 * moment a hyphenated member is added.
 */
const VERIFICATION_TO_WIRE: Readonly<Record<string, string>> = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  DOCS_REQUESTED: 'docs_requested',
};

const PRACTICE_TO_WIRE: Readonly<Record<string, string>> = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  VACATION: 'vacation',
};
