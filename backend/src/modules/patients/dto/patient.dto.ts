/**
 * The clinician's patient projections (API §4.1, §4.3, §4.4).
 *
 * ## Two shapes, and the difference is who is asking
 *
 * `PatientView` is what a **clinician with a care relationship** sees:
 * the identifiers in the clear, because they are treating this person.
 * `MaskedIdentity` (from `shared/phi`) is what an **administrator** sees
 * before elevating — API §0.4: "admin patient projections are masked
 * unless revealed".
 *
 * The two are not a flag on one shape. `MaskedIdentity` has no field
 * that can hold a clear value, which is what makes a handler unable to
 * leak an identifier by omission; a `masked: boolean` on one type would
 * put the disclosure one forgotten branch away.
 *
 * ## The derived fields are computed, never stored (M10.6)
 *
 * `age` from `dateOfBirth`, `hasSevereAllergy` from the allergy rows,
 * `nextAppointment` from the appointment book. A stored `age` disagrees
 * with the birth date within a year, and a stored `hasSevereAllergy`
 * disagrees with the allergy list the moment one is added — which for
 * that particular field is a patient-safety failure, not a stale cache.
 *
 * `lastVisit` is the exception and is read from `patients.last_visit_at`,
 * the denormalised column the schema keeps precisely because the list
 * sorts on it and the live answer is a lateral over four fact tables.
 *
 * ## `allergies` is always present on §4.3 and §4.4
 *
 * API §4's business rules make this explicit: "severe allergy drives the
 * fixed allergy strip — 4.3/4.4 must always include `allergies` +
 * `hasSevereAllergy`". They are not optional includes a caller asks for,
 * because a client that forgot to ask would render a chart with the
 * safety strip missing.
 */

export interface PatientAllergyView {
  readonly id: string;
  readonly allergen: string;
  /** `mild | moderate | severe`. */
  readonly severity: string;
  readonly reaction: string;
  readonly notes: string | null;
  readonly recordedAt: string;
  /** `users.public_id` of the clinician who recorded it, or null. */
  readonly recordedBy: string | null;
}

export interface PatientAlertView {
  readonly id: string;
  /** `critical | warning`. */
  readonly severity: string;
  readonly message: string;
  readonly active: boolean;
  /** Why it was resolved, when a reason was given (BR-DEC-003); else null. */
  readonly resolutionReason: string | null;
  readonly createdAt: string;
}

/** The doctor a patient is assigned to — a name and a handle, no more. */
export interface AssignedDoctorView {
  readonly id: string;
  readonly fullName: string;
  readonly specialty: string;
}

export interface PatientView {
  /** `patients.public_id` — the `PT-…` handle. Never the uuid. */
  readonly id: string;
  readonly mrn: string;
  readonly fullName: string;
  /** ISO-8601 date, no time component. */
  readonly dateOfBirth: string;
  /** Derived, never stored (M10.6). */
  readonly age: number;
  readonly gender: string;
  readonly bloodType: string;
  readonly phone: string;
  readonly email: string | null;
  readonly address: string | null;
  readonly photoUrl: string | null;
  /** `active | under-treatment | critical | follow-up | discharged`. */
  readonly status: string;
  /** `low | medium | high | critical`. */
  readonly riskLevel: string;
  readonly registeredAt: string;
  /** From the denormalised column — see the header. */
  readonly lastVisit: string | null;
  /** Derived from the appointment book: the next live slot, or null. */
  readonly nextAppointment: string | null;
  readonly assignedDoctor: AssignedDoctorView | null;
  /** Always present (API §4 business rules). */
  readonly allergies: readonly PatientAllergyView[];
  /** Derived from `allergies` — the fixed safety strip's trigger. */
  readonly hasSevereAllergy: boolean;
  /**
   * Whether this account has claimed a platform login (ADR-030).
   * A boolean, never the `usr_…` handle: which account a patient signs
   * in as is not a clinical fact and has no place on a chart.
   */
  readonly hasPortalAccount: boolean;
}

/**
 * `GET /patients/{id}/profile` — API §4.4's header plus summary.
 *
 * The bundle is the one payload the profile screen loads before it
 * renders anything, and the per-tab endpoints of §4.5 are the lazy half.
 * What is in here is what the **header and the summary card** need:
 * everything a clinician must see before they act, and nothing that can
 * wait for a tab.
 */
/**
 * The latest vitals reading.
 *
 * Blood pressure is two columns and stays two fields: API §4.6 says
 * "systolic/diastolic split", and a `"120/80"` string on the wire is a
 * value nobody can compare, chart or flag against a reference range.
 *
 * `bmi` is the database's generated column rather than arithmetic here —
 * one definition, applied to every row ever written, including those
 * inserted by a migration or a seed.
 */
export interface PatientVitalsView {
  readonly recordedAt: string;
  readonly systolic: number;
  readonly diastolic: number;
  readonly heartRate: number;
  readonly temperatureC: number;
  readonly respiratoryRate: number;
  readonly oxygenSaturation: number;
  readonly weightKg: number;
  readonly heightCm: number;
  readonly bmi: number | null;
}

export interface PatientMedicationView {
  readonly id: string;
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  /** `active | completed | discontinued | …` — the `MedicationStatus` enum. */
  readonly status: string;
  readonly startDate: string;
  readonly endDate: string | null;
  /**
   * The `RX-…` this entry was materialised from, or `null` when the
   * patient reported it themselves (RM M13.6 — "Rx-linked **+ external
   * entries**").
   *
   * The distinction is clinical, not bookkeeping: an Rx-linked row went
   * through the M13.2 safety screen at signing, and an external one
   * never did — nobody checked it against this patient's allergies or
   * their other drugs. A list that renders both identically invites a
   * reader to assume the same assurance behind each.
   */
  readonly prescriptionId: string | null;
}

export interface EmergencyContactView {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly phone: string;
  readonly isPrimary: boolean;
}

export interface PatientProfileBundle {
  readonly patient: PatientView;
  /** The most recent vitals row, or null when none has been taken. */
  readonly latestVitals: PatientVitalsView | null;
  /** Active medications, most recent first, capped for the summary card. */
  readonly medications: readonly PatientMedicationView[];
  readonly chronicConditions: readonly string[];
  readonly emergencyContacts: readonly EmergencyContactView[];
  /** Active alerts only — a resolved alert is history, not a warning. */
  readonly clinicalAlerts: readonly PatientAlertView[];
}

/**
 * Whole years elapsed, in UTC.
 *
 * `dateOfBirth` is a `date` column with no time and no zone, so the
 * calculation is a calendar comparison rather than a duration: dividing
 * elapsed milliseconds by 365.25 days is wrong for anyone born on a leap
 * day and drifts for everyone else.
 *
 * Deliberately duplicated from `users/dto/self-profile.dto.ts`'s `ageOn`
 * rather than imported — M2.2's zone 1 forbids reaching into a sibling
 * module, and this is nine lines of calendar arithmetic with a test on
 * each side rather than a dependency worth creating a kernel for.
 */
export function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();

  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  const beforeBirthday =
    monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate());

  if (beforeBirthday) age -= 1;

  return age;
}

/**
 * `POST /patients/{id}/reveal` — the clear identity (API §4.9, RM M7.3).
 *
 * The inverse of `MaskedIdentity`, field for field, with `revealed: true`
 * so a client holding both shapes can tell which one it has. `revealedAt`
 * is the instant on the audit row, so the client's elevation window and
 * the ledger agree on when it opened.
 */
export interface RevealedIdentity {
  readonly patientId: string;
  readonly fullName: string;
  readonly mrn: string;
  readonly email?: string;
  readonly phone: string;
  readonly dateOfBirth: string;
  readonly revealed: true;
  readonly revealedAt: string;
}
