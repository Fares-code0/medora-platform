import {
  doctorEndpoints,
  type WireDoctorDetail,
  type WireDoctorSummary,
} from '@/api/endpoints/doctors';
import { EndpointNotImplementedError } from '@/api/seam';

import type {
  Department,
  DoctorSearchResult,
  DoctorService,
  PatientSafeDoctor,
  Specialty,
} from './model/types';

/**
 * The HTTP adapter for doctor discovery — checklist G-01…G-05, G-08.
 *
 * ── Three of four methods are live; the fourth is not, and says so ───
 *
 * `search`, `getById` and `listSpecialties` call routes that exist
 * (contract §3, all ✅ LIVE). `listDepartments` does not, because
 * `GET /patient/departments` is not built: `departments` is the
 * administration module's table (ADR-004, M23) and reading it from the
 * doctors module would misplace ownership.
 *
 * So this adapter is **partial** rather than all-or-nothing, which is a
 * departure from `unavailableService` and is deliberate. The alternative
 * — holding three working endpoints back until a fourth arrives — would
 * keep a production build failing on doctor search for no reason other
 * than the shape of a helper. The one absent method throws the same
 * `EndpointNotImplementedError` the whole-service helper throws, so a
 * screen that calls it renders the same honest "not available yet" state
 * and nothing new had to be invented to express it.
 *
 * Filtering BY `departmentId` works today and is untouched by this: the
 * server accepts the parameter. What is missing is the list of
 * departments to choose from, which G-07 needs and which the contract
 * says to build from `departmentName` on the results until M23 lands.
 *
 * ── Fields the server does not project ───────────────────────────────
 *
 * `PatientSafeDoctor.hospital` has no counterpart in either the summary
 * or the detail projection. It is `null` here rather than derived from
 * `departmentName` or an office string, because a plausible value in a
 * field the server never sent is exactly the kind of invention §21 of
 * the working agreement forbids — and this one would print a hospital
 * name on a doctor's profile that no source states.
 *
 * Detail-only fields (`biography`, `education`, `officeLocation`) are
 * likewise `null`/`[]` on a search result rather than fetched per row:
 * the list projection does not carry them, and N round trips to fill a
 * list is not an acceptable substitute for a projection.
 */

function fromSummary(wire: WireDoctorSummary): PatientSafeDoctor {
  return {
    id: wire.id,
    fullName: wire.fullName,
    title: wire.title,
    specialty: wire.specialty,
    departmentName: wire.departmentName,
    photoUrl: wire.photoUrl,
    yearsOfExperience: wire.yearsOfExperience,
    languages: wire.languages,
    ratingAvg: wire.ratingAvg,
    // Not in the list projection.
    biography: null,
    education: [],
    officeLocation: null,
    // From the active employment (contract §2); null when the doctor has none.
    hospital: wire.hospital ?? null,
  };
}

function fromDetail(wire: WireDoctorDetail): PatientSafeDoctor {
  return {
    ...fromSummary(wire),
    biography: wire.biography,
    education: wire.education,
    officeLocation: wire.officeLocation,
  };
}

export const httpDoctorService: DoctorService = {
  /**
   * `hasMore` is derived from the server's own pagination rather than
   * from the length of the page: a page past the end is an empty page,
   * not an error (`patient-doctor.service.ts`), and comparing lengths
   * would call a full last page "has more" and ask for an empty one.
   */
  async search(params): Promise<DoctorSearchResult> {
    const page = params.page ?? 1;
    const response = await doctorEndpoints.search({
      q: params.q,
      specialtyId: params.specialtyId,
      departmentId: params.departmentId,
      hospitalId: params.hospitalId,
      page,
    });
    const { items, totalItems, totalPages } = response.data;
    return {
      items: items.map(fromSummary),
      totalItems,
      hasMore: response.data.page < totalPages,
    };
  },

  async getById(id): Promise<PatientSafeDoctor> {
    const response = await doctorEndpoints.byId(id);
    return fromDetail(response.data);
  },

  async listSpecialties(): Promise<readonly Specialty[]> {
    const response = await doctorEndpoints.specialties();
    return response.data.map((specialty) => ({ id: specialty.id, name: specialty.name }));
  },

  /** `GET /patient/departments` is contract §3.4 P3.4 — NOT BUILT (M23). */
  listDepartments(): Promise<readonly Department[]> {
    return Promise.reject(new EndpointNotImplementedError('BE-11 / M23', 'capability.departments'));
  },
};
