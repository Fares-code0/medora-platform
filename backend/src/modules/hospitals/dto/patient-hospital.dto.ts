/**
 * The patient-facing hospital directory (contract §2). Organisational data
 * only — names, a city, a phone — and only fields the schema holds: a field
 * the schema lacks (a hospital description) is `null`, never invented.
 */

export interface PatientHospitalSummary {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly clinicCount: number;
  readonly departmentCount: number;
}

export interface PatientHospitalDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly phone: string | null;
  readonly clinics: readonly { readonly id: string; readonly name: string }[];
  readonly locations: readonly {
    readonly id: string;
    readonly name: string;
    readonly addressLine: string | null;
    readonly city: string | null;
    readonly timezone: string | null;
  }[];
  readonly departments: readonly { readonly id: string; readonly name: string }[];
  readonly specialties: readonly { readonly id: string; readonly name: string }[];
}

export interface PatientHospitalPage {
  readonly items: readonly PatientHospitalSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}
