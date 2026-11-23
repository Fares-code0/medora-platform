/**
 * Server-derived hospital scope carried for authorization migration work.
 *
 * This value is observational in Phase 22 shadow mode. It does not grant
 * access, select data, or change the existing authorization decisions.
 */
export type HospitalContext =
  | {
      readonly kind: 'hospital';
      readonly hospitalId: string;
      readonly hospitalName: string;
      readonly source: 'doctor_employment' | 'hospital_admin_assignment';
    }
  | { readonly kind: 'platform'; readonly clinicalDataAccess: false }
  | {
      readonly kind: 'unresolved';
      readonly reason:
        | 'no_active_employment'
        | 'ambiguous_active_employment'
        | 'ambiguous_hospital_admin_scope'
        | 'admin_scope_not_mapped'
        | 'resource_required'
        | 'unsupported_role'
        | 'resolution_unavailable';
    };

/** A symbol keeps client-supplied fields from impersonating server context. */
export const HOSPITAL_CONTEXT = Symbol('HOSPITAL_CONTEXT');

export interface RequestWithHospitalContext {
  [HOSPITAL_CONTEXT]?: HospitalContext;
}
