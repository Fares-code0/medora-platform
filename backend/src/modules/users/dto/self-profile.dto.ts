/**
 * The caller's own profile — `PATIENT_MOBILE_API_CONTRACT.md` §2.1 and
 * **API §3.1** (ADR-036).
 *
 * Three halves, because an account has up to three rows and they mean
 * different things. `account` is the `users` row — who signs in.
 * `patient` is the clinical record, **null** for an account not linked
 * to one (ADR-030 §4, RA-030.1); that null is the normal state straight
 * after registration, not an error. `doctor` is the professional
 * profile, **null** for everyone who is not a practitioner.
 *
 * ADR-036 records why one route serves both: `/me/profile` means "the
 * caller's own profile", the patient contract and API §3.1 both name that
 * path, and two controllers cannot claim one path — Nest registers both
 * and Express serves whichever module loaded first. The composed document
 * is additive for the patient client, which sees the same `account` and
 * `patient` it always did.
 *
 * ## What is deliberately absent, and why each one
 *
 * `mrn` — the medical record number is an internal clinical identifier;
 * UX §1.5.6 shows administrators only its last four digits. It is not a
 * thing a patient needs in an app, and putting it on the wire makes it a
 * thing an attacker can harvest.
 *
 * `medicalNotes` — a clinician's free-text working note *about* the
 * patient. Reading it is a clinical conversation, not a profile field.
 *
 * `status` and `riskLevel` — triage classifications (`critical`,
 * `under-treatment`, a risk band). Disclosing a risk level to a patient
 * with no clinical context is a patient-safety question that nobody has
 * decided, and it is adjacent to ADR-031 rather than covered by it.
 *
 * `assignedDoctorId` — the care assignment is the clinic's, and exposing
 * it here would make this route a second, unaudited path to information
 * that belongs to the appointments and care-team surfaces.
 *
 * `createdBy` / `updatedBy` / `deletedAt` — internal audit columns.
 *
 * `age` is **derived here and never stored** (DB §14.5-6): a stored age
 * beside a date of birth is guaranteed to disagree with it within a year.
 */

export interface PatientAccountView {
  /** `users.public_id` — the `usr_…` handle, never the uuid. */
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string;
  readonly email: string;
  readonly phone: string;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
  readonly avatarUrl: string | null;
}

export interface PatientRecordView {
  /** `patients.public_id` — the `PT-…` handle. */
  readonly id: string;
  readonly fullName: string;
  /** ISO-8601 date, no time component. */
  readonly dateOfBirth: string;
  /** Derived from `dateOfBirth`, never stored. */
  readonly age: number;
  readonly gender: string;
  readonly bloodType: string;
  readonly phone: string;
  /** `patients.email` — a **contact** field, not the login. */
  readonly email: string | null;
  readonly address: string | null;
  readonly photoUrl: string | null;
  readonly registeredAt: string;
  readonly lastVisitAt: string | null;
}

/**
 * The professional half — API §3.1's "doctor (or admin) profile
 * document", as the practitioner's own settings screen reads it.
 *
 * This is the **self** projection, and it is neither of the two the
 * doctors module holds. It carries more than `PatientDoctorSummary` does
 * — the licence number and the contact fields are the practitioner's own
 * and they are editing them — and less than `AdminDoctorDetail` does:
 * no `patientsCount`, no `appointments30d`, no `affectedAppointments`,
 * because those are the clinic's operational view of a practitioner
 * rather than the practitioner's view of themselves.
 *
 * `verificationStatus` is read-only here. A doctor sees where their
 * verification stands — that is their own business — and moves it
 * nowhere: only `doctors.verify` holders do, through API §3.6.
 */
export interface DoctorProfileView {
  /** `doctors.id`. There is no public `doc_…` handle on this table. */
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly departmentName: string | null;
  readonly licenseNumber: string;
  readonly licenseExpiresOn: string | null;
  readonly professionalCategory: string | null;
  readonly yearsOfExperience: number;
  readonly biography: string | null;
  readonly languages: readonly string[];
  readonly education: readonly string[];
  readonly certifications: readonly string[];
  readonly skills: readonly string[];
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly officeLocation: string | null;
  readonly officeHours: string | null;
  readonly linkedinUrl: string | null;
  readonly websiteUrl: string | null;
  /**
   * A short-TTL signed URL (`DOWNLOAD_TTL_SECONDS`), minted per read —
   * never the stored value, which is a `files.id`. Null when there is no
   * photo or the photo has not cleared the M25.3 malware scan.
   */
  readonly photoUrl: string | null;
  /** Read-only: `pending | verified | rejected | docs_requested`. */
  readonly verificationStatus: string;
  readonly verifiedAt: string | null;
  /** Read-only: `active | suspended | vacation`. */
  readonly practiceStatus: string;
  readonly ratingAvg: number | null;
}

export interface SelfProfileView {
  readonly account: PatientAccountView;
  /** Null when the account has not been linked to a clinical record. */
  readonly patient: PatientRecordView | null;
  /** Null for every account that is not a practitioner. */
  readonly doctor: DoctorProfileView | null;
}

/**
 * Whole years elapsed, in UTC.
 *
 * `dateOfBirth` is a `date` column with no time and no zone, so the
 * calculation is a calendar comparison rather than a duration: dividing
 * elapsed milliseconds by 365.25 days is wrong for anyone born on a leap
 * day and drifts for everyone else.
 */
export function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();

  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  const beforeBirthday =
    monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate());

  if (beforeBirthday) age -= 1;

  return age;
}
