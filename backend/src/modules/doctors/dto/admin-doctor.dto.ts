/**
 * The administrator's view of a practitioner (API §3.4–3.7, RM M9.3/M9.5).
 *
 * ## This is the opposite projection to `patient-doctor.dto.ts`
 *
 * That file exists to keep a licence number and a personal mobile number
 * away from patients. This one is the roster an administrator manages
 * the clinic from, so it carries them — and the two live side by side,
 * in one module, with `FORBIDDEN_DOCTOR_FIELDS` naming exactly what
 * separates them. Neither is a filtered version of the other: both are
 * built column by column, so adding a column to `doctors` reaches
 * neither by default.
 *
 * `contactEmail`, `contactPhone` and the emergency contact are on the
 * detail shape and **not** on the list. A roster page renders dozens of
 * rows at once and needs none of them; putting them there would spread
 * staff personal contact details across every list response, every
 * client cache and every log line that captures one.
 *
 * ## The operational statistics, and what they are not
 *
 * `patientsCount`, `appointments30d`, `ratingAvg` and `lastActiveAt` are
 * the four columns UX §3.2 puts on the roster. They are counts and
 * aggregates — no patient identity crosses this boundary, which is why
 * an administrator holding `doctors.manage` but not `patients.view` can
 * read them without reaching PHI.
 */

export interface AdminDoctorSummary {
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly departmentName: string | null;
  readonly licenseNumber: string;
  readonly licenseExpiresOn: string | null;
  readonly professionalCategory: string | null;
  /** `pending | verified | rejected | docs_requested`. */
  readonly verificationStatus: string;
  /** `active | suspended | vacation`. */
  readonly practiceStatus: string;
  readonly ratingAvg: number | null;
  /** `users.last_active_at` — null for an account that never signed in. */
  readonly lastActiveAt: string | null;
  /** `doctors.created_at` — the "joined" column the range filter sorts on. */
  readonly joinedAt: string;
  readonly patientsCount: number;
  readonly appointments30d: number;
}

export interface VerificationDocumentView {
  readonly id: string;
  /** `medical_license | degree_certificate | national_id | other`. */
  readonly kind: string;
  readonly fileId: string;
  readonly uploadedAt: string;
  readonly expiresOn: string | null;
  /** `pending | approved | rejected`. */
  readonly decision: string;
  readonly decidedAt: string | null;
  readonly rejectReason: string | null;
  readonly checks: {
    readonly authentic: boolean;
    readonly current: boolean;
    readonly identityMatch: boolean;
  };
}

export interface AdminDoctorDetail extends AdminDoctorSummary {
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly officeLocation: string | null;
  readonly officeHours: string | null;
  readonly biography: string | null;
  readonly yearsOfExperience: number;
  readonly languages: readonly string[];
  readonly education: readonly string[];
  readonly certifications: readonly string[];
  readonly skills: readonly string[];
  readonly employeeId: string | null;
  readonly verifiedAt: string | null;
  readonly documents: readonly VerificationDocumentView[];
  /**
   * What suspending this doctor would disturb — API §3.7's consequence
   * preview, returned by 3.5 so the confirmation dialog can be drawn
   * before anything is pressed.
   */
  readonly affectedAppointments: number;
  /**
   * True when every **required** document is approved — the gate API
   * §3.6's complete-verification is enabled by (RM M9.3).
   */
  readonly verifiable: boolean;
}

/** The result of a verification decision, so the client re-renders from it. */
export interface VerificationResult {
  readonly doctorId: string;
  readonly verificationStatus: string;
  readonly verifiedAt: string | null;
}

/** API §3.7 — the suspension result carries what it actually affected. */
export interface PracticeStatusResult {
  readonly doctorId: string;
  readonly practiceStatus: string;
  readonly affectedAppointments: number;
}
