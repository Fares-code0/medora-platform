/**
 * The patient's view of their own appointments — contract §4.1/§4.2.
 *
 * ## What is deliberately NOT here: `availableActions`
 *
 * The contract's §4 specifies `availableActions` on every appointment,
 * and the rule that goes with it — *"the client must never compute
 * whether an action is allowed"*. That field is **omitted** rather than
 * shipped empty or guessed, because the server cannot yet answer it
 * honestly.
 *
 * ADR-001's transition table says which *statuses* may follow which. It
 * does not say **who** may make a transition, and no source in this
 * repository states a patient's cancellation window, reschedule cut-off,
 * or whether a patient may cancel a `confirmed` appointment at all. Those
 * are product decisions (see `PATIENT_MOBILE_API_CONTRACT.md` §4).
 *
 * Three ways to be wrong here, and all three were rejected:
 *
 *  - **`availableActions: []`** would assert "no action is available",
 *    which is a claim nobody has authority to make. The client would
 *    render an appointment with no cancel button and the patient would
 *    conclude they cannot cancel.
 *  - **Guessing a window** ("cancel allowed up to 24 h before") invents
 *    clinical-operations policy in a DTO.
 *  - **Letting the client compute it** is the one thing §4 forbids.
 *
 * Omitting the field is the honest option: the mobile client renders
 * read-only appointment views today, and the field arrives with the write
 * routes it describes, once the policy exists. An absent field is a
 * visible gap; a wrong one is a silent defect.
 */

/** The doctor as a patient may see them — the §3 projection, embedded. */
export interface AppointmentDoctorView {
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly photoUrl: string | null;
}

export interface PatientAppointmentSummary {
  /** `appointments.public_id` — `APT-…`. */
  readonly id: string;
  /** ISO-8601 **UTC**. The client formats; it never computes. */
  readonly startsAt: string;
  readonly durationMin: number;
  /** ADR-001 wire vocabulary, kebab-case: `no-show`, `awaiting-patient`. */
  readonly status: string;
  readonly priority: string;
  readonly reason: string;
  readonly isNewPatient: boolean;
  readonly isFollowUp: boolean;
  readonly visitType: string;
  readonly departmentName: string | null;
  readonly doctor: AppointmentDoctorView;
}

/** One entry of the appointment's history (`appointment_events`). */
export interface PatientAppointmentEvent {
  readonly action: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly occurredAt: string;
  /**
   * A **coarse category**, never a staff member's name, id or email.
   *
   * `appointment_events` stores `actor_name` — the display name as it was
   * at the time — and it is not projected here. An appointment history is
   * not a route into the clinic's staff directory, and a patient does not
   * need to know which receptionist moved their booking. `system` covers
   * an actor-less row.
   */
  readonly actor: 'patient' | 'clinic' | 'system';
  readonly reason: string | null;
}

export interface PatientAppointmentDetail extends PatientAppointmentSummary {
  readonly notes: string | null;
  readonly cancelledReason: string | null;
  readonly events: readonly PatientAppointmentEvent[];
}
