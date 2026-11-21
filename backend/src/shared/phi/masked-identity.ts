/**
 * The masked patient projection (RM M7.3, API §4.11, §18).
 *
 * API §0.4: "Admin patient projections are **masked** unless revealed".
 * This is the projection — the shape an admin list row, a waiting-room
 * entry or a queue entry carries before anyone has elevated.
 *
 * ## Why this is a type and not a convention
 *
 * The alternative is each admin endpoint calling `maskName` on its way
 * out. That works until one of them forgets, and the failure is a PHI
 * disclosure that looks exactly like a working endpoint. `MaskedIdentity`
 * has no field that can hold a clear value, so a handler returning one
 * cannot leak an identifier by omission — only by deliberately building
 * a different object, which is a thing a reviewer can see.
 *
 * `revealed: false` is carried explicitly rather than left implied. The
 * frontend needs to know whether a row is masked to decide whether to
 * offer the reveal affordance at all, and a missing field would be
 * indistinguishable from an old client's.
 */

import { maskDateOfBirth, maskEmail, maskMrn, maskName, maskPhone } from './phi-mask';

/** The clear record, as it comes out of the database. */
export interface PatientIdentity {
  readonly patientId: string;
  readonly fullName: string;
  readonly mrn: string;
  readonly email?: string;
  readonly phone?: string;
  readonly dateOfBirth?: string;
}

/**
 * The masked projection.
 *
 * `patientId` is **not** masked, and that is deliberate: it is the
 * opaque `PT-…` handle every subsequent request is keyed by, so masking
 * it would make the row unusable. It is not an identifier in the PHI
 * sense — it says nothing about the person — and the care-scoping of
 * `PatientScopeService` is what stops it being enumerated.
 */
export interface MaskedIdentity {
  readonly patientId: string;
  readonly name: string;
  readonly mrn: string;
  readonly email?: string;
  readonly phone?: string;
  readonly dateOfBirth?: string;
  readonly revealed: false;
}

/**
 * Masks every identifier on a patient record.
 *
 * Absent optional fields stay absent rather than becoming a mask: a mask
 * asserts "there is a value here you may not see", which would be a
 * false statement about a patient who registered without an email
 * (API §4: "email/address/insurance optional fields appear only when
 * provided").
 */
export function maskPatientIdentity(identity: PatientIdentity): MaskedIdentity {
  return {
    patientId: identity.patientId,
    name: maskName(identity.fullName),
    mrn: maskMrn(identity.mrn),
    ...(identity.email === undefined ? {} : { email: maskEmail(identity.email) }),
    ...(identity.phone === undefined ? {} : { phone: maskPhone(identity.phone) }),
    ...(identity.dateOfBirth === undefined
      ? {}
      : { dateOfBirth: maskDateOfBirth(identity.dateOfBirth) }),
    revealed: false,
  };
}

export function maskPatientIdentities(
  identities: readonly PatientIdentity[],
): readonly MaskedIdentity[] {
  return identities.map(maskPatientIdentity);
}
