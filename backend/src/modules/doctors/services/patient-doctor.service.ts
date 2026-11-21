/**
 * Patient-facing doctor discovery (ADR-030 §10, contract §3).
 *
 * Thin by design: the safety predicates live in the repository, where
 * they cannot be bypassed by a second call site, and the projection lives
 * in the DTO, where a test can assert it. What is left here is paging
 * arithmetic and the one decision this layer owns — that an invisible
 * doctor and a non-existent one are the same 404.
 *
 * And the photo. The repository returns `doctors.photo_url` as stored —
 * a `files.id` since the profile-photo fix — and this layer swaps it for
 * what `ProfilePhotoUrls` resolves: a short-TTL signed URL for a photo
 * that cleared the malware scan, otherwise `null`. Never the stored id.
 * A page is resolved with one lookup, not one per doctor.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { ProfilePhotoUrls } from '../../../shared/files';
import type { PatientDoctorDetail, PatientDoctorSummary } from '../dto/patient-doctor.dto';
import type { DoctorSearchQuery } from '../dto/patient-doctor.schema';
import { PatientDoctorRepository } from '../repositories/patient-doctor.repository';

/** API §0.2's `Paginated<T>`, verbatim. */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class PatientDoctorService {
  constructor(
    private readonly doctors: PatientDoctorRepository,
    private readonly photos: ProfilePhotoUrls,
  ) {}

  async search(query: DoctorSearchQuery): Promise<Paginated<PatientDoctorSummary>> {
    const { items, totalItems } = await this.doctors.search(query);
    const photo = await this.photos.lookup(items.map((item) => item.photoUrl));

    return {
      items: items.map((item) => ({ ...item, photoUrl: photo(item.photoUrl) })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      // A page past the end is an empty page, not an error — the client
      // may hold a stale total. `Math.ceil(0 / n)` is 0, which is the
      // honest answer for an empty result rather than a misleading 1.
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async byId(doctorId: string): Promise<PatientDoctorDetail> {
    const doctor = await this.doctors.findById(doctorId);

    // One answer for "no such doctor" and for "not visible to patients".
    // Distinguishing them would let a caller discover that a suspended or
    // unverified practitioner exists, which is precisely what the
    // visibility rule is keeping from them.
    if (doctor === null) throw AppException.notFound('Doctor not found');

    return { ...doctor, photoUrl: await this.photos.resolve(doctor.photoUrl) };
  }

  listSpecialties(): Promise<readonly { id: string; name: string; parentId: string | null }[]> {
    return this.doctors.listSpecialties();
  }
}
