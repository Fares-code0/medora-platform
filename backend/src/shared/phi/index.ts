/**
 * Public API — PHI masking (RM M7.3).
 *
 * This kernel is display only. It does not import `shared/authz` and
 * exports nothing that decides whether a value may be unmasked — the
 * reveal path of RM M7.3 owns that, and keeping the two apart is what
 * makes "a masking function cannot be talked into returning the clear
 * value" structural rather than a promise in a comment.
 */
export {
  PHI_FIELD_KINDS,
  PHI_FIELD_LABEL,
  maskDateOfBirth,
  maskEmail,
  maskMrn,
  maskName,
  maskPhi,
  maskPhone,
  type PhiFieldKind,
} from './phi-mask';
export {
  maskPatientIdentities,
  maskPatientIdentity,
  type MaskedIdentity,
  type PatientIdentity,
} from './masked-identity';
