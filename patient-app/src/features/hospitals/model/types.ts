import type { PagedResult } from '@/api/paged';

/**
 * Hospitals, as a patient discovers them (contract §2).
 *
 * Only what the schema actually has: an absent field is `null` and
 * renders as absent, never as a plausible invention.
 */
export interface HospitalSummary {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly clinicCount: number;
  readonly departmentCount: number;
}

export interface NamedRef {
  readonly id: string;
  readonly name: string;
}

export interface HospitalLocation {
  readonly id: string;
  readonly name: string;
  readonly addressLine: string | null;
  readonly city: string | null;
  /** IANA zone, when the hospital's location has one. */
  readonly timezone: string | null;
}

export interface HospitalDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly phone: string | null;
  readonly clinics: readonly NamedRef[];
  readonly locations: readonly HospitalLocation[];
  readonly departments: readonly NamedRef[];
  readonly specialties: readonly NamedRef[];
}

export type HospitalPage = PagedResult<HospitalSummary>;

export interface HospitalService {
  list(params: { readonly q?: string; readonly page?: number }): Promise<HospitalPage>;
  getById(id: string): Promise<HospitalDetail>;
}
