/**
 * The patient-safe doctor projection.
 *
 * ── The forbidden fields, and why they are not merely "hidden" ───────
 *
 * `doctors` (`04-people.prisma:21`) carries `license_number`,
 * `license_expires_on`, `employee_id`, `contact_email`, `contact_phone`,
 * `emergency_contact_name`, `emergency_contact_phone`, `linkedin_url` and
 * verification documents. **None of them may ever reach a patient.**
 *
 * This interface omits them, and that omission is a client-side control,
 * which is to say it is not a control at all: hiding a field in the UI
 * after it has crossed the wire has already disclosed a practitioner's
 * licence number and personal phone number to every patient who runs a
 * proxy (audit R-3). The real control is **BE-04, a separate server-side
 * projection** with a contract test asserting the forbidden fields are
 * absent from the response body.
 *
 * What this interface does buy: the fixture cannot contain them, the
 * components cannot render them, and `projections.test.ts` fails if a
 * forbidden key appears anywhere in this feature's data. That is the
 * client's half of the job, done honestly, with the server's half named.
 *
 * The allow-list is specified in `docs/PUBLIC_PROJECTIONS.md` (A-05).
 */

import type { PagedResult } from '@/api/paged';

export interface PatientSafeDoctor {
  readonly id: string;
  readonly fullName: string;
  /** "Dr", "Prof" — display only. */
  readonly title: string | null;
  /** The display string on `doctors.specialty`. */
  readonly specialty: string;
  readonly departmentName: string | null;
  readonly photoUrl: string | null;
  readonly yearsOfExperience: number | null;
  readonly languages: readonly string[];
  readonly biography: string | null;
  readonly education: readonly string[];
  /** Derived server-side from `SatisfactionSurvey`; null when unrated. */
  readonly ratingAvg: number | null;
  /**
   * The hospital of the doctor's active employment — an entity now
   * (multi-hospital, contract §2), not the old free-text string. `null`
   * when the server names none; never derived from a department or an
   * office string.
   */
  readonly hospital: HospitalRef | null;
  readonly officeLocation: string | null;
}

export interface HospitalRef {
  readonly id: string;
  readonly name: string;
}

export interface Specialty {
  readonly id: string;
  readonly name: string;
}

export interface Department {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface DoctorSearchParams {
  readonly q?: string;
  readonly specialtyId?: string;
  readonly departmentId?: string;
  readonly hospitalId?: string;
  readonly page?: number;
}

/**
 * One page of doctors.
 *
 * The shape is `PagedResult` — the same one appointments and the
 * notification feed return — so `usePagedQuery` can merge its pages
 * without knowing what a doctor is.
 */
export type DoctorSearchResult = PagedResult<PatientSafeDoctor>;

/**
 * The port.
 *
 * `search` is server-side, with no client-side alternative offered. A
 * client that pulls the whole roster and filters it locally is both slow
 * and a disclosure — it has downloaded every practitioner in the clinic
 * onto the phone (checklist G-05).
 *
 * There is no `verified` parameter either: verified-and-active-only is a
 * SERVER-SIDE DEFAULT, not a filter a client can turn off. Showing an
 * unverified or suspended practitioner to a patient is a safety issue
 * (checklist G-08).
 */
export interface DoctorService {
  search(params: DoctorSearchParams): Promise<DoctorSearchResult>;
  getById(id: string): Promise<PatientSafeDoctor>;
  listSpecialties(): Promise<readonly Specialty[]>;
  listDepartments(): Promise<readonly Department[]>;
}

/**
 * The keys a patient-facing doctor payload must never contain.
 * `src/test/projections.test.ts` walks every fixture and every rendered
 * prop against this list.
 */
export const FORBIDDEN_DOCTOR_FIELDS: readonly string[] = [
  'licenseNumber',
  'license_number',
  'licenseExpiresOn',
  'employeeId',
  'employee_id',
  'contactEmail',
  'contactPhone',
  'contact_phone',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergency_contact_phone',
  'linkedinUrl',
  'verificationDocuments',
];
