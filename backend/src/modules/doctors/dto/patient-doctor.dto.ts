/**
 * The patient-facing Doctor projection (ADR-030 §10, audit BE-04/R-3).
 *
 * **This is a projection, not a filter.** `doctors` carries a licence
 * number, a licence expiry, an employee id, a personal contact email and
 * phone, a next-of-kin name and phone, and a LinkedIn URL. API §3.4's
 * `GET /doctors` returns that entity to holders of `can:doctors.manage`
 * — it is the administrator's roster, and reusing it for a patient client
 * would put a practitioner's licence number and personal mobile number on
 * the wire to every patient in the clinic.
 *
 * Hiding those fields in a React Native screen is not a control. The data
 * would still cross the network, sit in every intermediary's logs, and be
 * one `console.log` away from a bug report. **Frontend authorization is
 * not authorization.** So the shape below is built field-by-field from
 * columns chosen deliberately, and `patient-doctor.dto.spec.ts` asserts
 * that none of the forbidden ones can appear in a serialized body.
 *
 * ## Why this file lists what it excludes
 *
 * A projection defined only by what it includes drifts silently: someone
 * adds a column to `doctors`, a `select` somewhere gains a spread, and
 * nothing fails. `FORBIDDEN_DOCTOR_FIELDS` makes the exclusion an
 * assertable value rather than an omission, which is what lets the test
 * fail on a leak instead of merely not testing for one.
 */

/** What a patient sees in a list or a search result. */
export interface PatientDoctorSummary {
  /** `doctors.id`. There is no public `doc_…` handle on this table. */
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly departmentName: string | null;
  readonly photoUrl: string | null;
  readonly yearsOfExperience: number;
  readonly languages: readonly string[];
  /** Null when no satisfaction survey has been recorded yet. */
  readonly ratingAvg: number | null;
}

/** What a patient sees on a doctor's profile screen. */
export interface PatientDoctorDetail extends PatientDoctorSummary {
  readonly biography: string | null;
  readonly education: readonly string[];
  readonly certifications: readonly string[];
  readonly skills: readonly string[];
  /** Where in the clinic to go — not a personal address. */
  readonly officeLocation: string | null;
  readonly officeHours: string | null;
  readonly specialties: readonly { readonly id: string; readonly name: string }[];
}

/**
 * Columns of `doctors` that must never reach a patient, in both the
 * database and the camelCase spellings, because a leak could arrive
 * through either a raw query or the Prisma client.
 *
 * `website_url` and `hospital` are deliberately **not** here — the first
 * is a professional page a practitioner publishes themselves, the second
 * a free-text display string (ADR-018 §1: there is no facility entity).
 * Neither is currently projected, but neither would be a disclosure if a
 * product decision later added it. Everything below would be.
 */
export const FORBIDDEN_DOCTOR_FIELDS: readonly string[] = [
  'license_number',
  'licenseNumber',
  'license_expires_on',
  'licenseExpiresOn',
  'employee_id',
  'employeeId',
  'contact_email',
  'contactEmail',
  'contact_phone',
  'contactPhone',
  'emergency_contact_name',
  'emergencyContactName',
  'emergency_contact_phone',
  'emergencyContactPhone',
  'linkedin_url',
  'linkedinUrl',
  // The account behind the practitioner. A patient has no business
  // knowing which `users` row a doctor signs in as.
  'user_id',
  'userId',
  // Verification is an internal governance workflow (UX 2.11). A patient
  // sees only verified doctors, so the field would carry one value and
  // leak the existence of the other three.
  'verification_status',
  'verificationStatus',
  'verified_by',
  'verifiedBy',
  // Audit columns.
  'created_by',
  'createdBy',
  'updated_by',
  'updatedBy',
  'deleted_at',
  'deletedAt',
];
