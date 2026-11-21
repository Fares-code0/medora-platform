import type { BloodType, Gender, Patient } from './types';

/**
 * The patient directory port (FE-10.2) — the doctor's own caseload.
 *
 * It lives in shared-domain rather than in the patients feature because
 * five features pick a patient from it: the patients list, appointment
 * booking, and the prescription, record and lab-order authoring flows.
 * Each used to read the seeded `MOCK_PATIENTS` constant directly, which in
 * a live build would have offered a doctor fictional patients to prescribe
 * for. They now all read this port through `usePatientDirectoryQuery`, so
 * the roster a picker offers is the roster the server returned.
 *
 * Typed from the backend (`PatientView`, API §4.1–4.2), not from the mock:
 * see `http-directory.ts` for the mapping.
 */

export interface NewPatientInput {
  readonly name: string;
  readonly dateOfBirth: string;
  readonly gender: Gender;
  readonly phone: string;
  readonly email: string;
  readonly address: string;
  readonly bloodType: BloodType;
  readonly insurance: string;
  readonly medicalNotes: string;
}

export interface PatientListQuery {
  /**
   * A chronic condition to filter by, applied by the service rather than
   * on the client: the backend's list projection does not carry a
   * patient's conditions (only the profile bundle does), so the client
   * cannot filter on them — but the list endpoint accepts `condition`.
   */
  readonly condition?: string | null;
}

export interface PatientDirectoryService {
  /** Every patient in the caller's care scope. */
  listPatients(query?: PatientListQuery): Promise<readonly Patient[]>;
  /**
   * Registers a patient. `registeringDoctor` is a display name the mock
   * stamps as the assigned doctor; the server assigns the caller itself.
   */
  createPatient(input: NewPatientInput, registeringDoctor: string): Promise<Patient>;
  /**
   * What this source can store. `insurance` is false over HTTP — the
   * registration contract (API §4.2) has no insurance field — and a form
   * that collected it anyway would discard what the doctor typed while
   * reporting success.
   */
  readonly capabilities: { readonly insurance: boolean };
}
