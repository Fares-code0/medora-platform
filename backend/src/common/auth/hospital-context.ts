/**
 * Server-derived hospital scope (Phase 22, shadow mode).
 *
 * Observational only: it does not grant access, select data, or change any
 * existing authorization decision. It is resolved on demand, at most once
 * per request (`HospitalContextService.forRequest`), never read from the
 * client.
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
