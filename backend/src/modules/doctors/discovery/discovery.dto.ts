/**
 * Patient discovery projections (DR-09, OD-10, OD-14).
 *
 * Built field by field from public, non-PHI columns. There is no patient
 * identifier, no booking detail and no count of bookings in any shape here:
 * the only availability signal is "this is the earliest free published slot".
 */

export interface NextAvailableSlot {
  readonly slotId: string;
  readonly startsAt: string;
  readonly durationMinutes: number;
  /** The hospital's IANA timezone, so the client can render local time. */
  readonly timezone: string;
}

/** `null` for an uninsured patient: nothing is flagged and nothing is filtered (OD-14). */
export type InsuranceFlag = { readonly covered: boolean } | null;

export interface DiscoveryLocation {
  readonly id: string;
  readonly name: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly countryCode: string;
}

export interface DiscoveryRow {
  readonly hospital: { readonly id: string; readonly name: string };
  /** Clinics are not linked to a doctor's employment in the data model, so this is always null. */
  readonly clinic: { readonly id: string; readonly name: string } | null;
  readonly location: DiscoveryLocation | null;
  readonly doctor: {
    readonly id: string;
    readonly fullName: string;
    readonly title: string | null;
    readonly photoUrl: string | null;
    readonly yearsOfExperience: number;
    readonly languages: readonly string[];
  };
  readonly specialty: { readonly id: string | null; readonly name: string };
  readonly department: { readonly id: string; readonly name: string } | null;
  /** Present only when the request carried `near` and the location has coordinates. */
  readonly distanceKm: number | null;
  /** Always null until DSC-03 (moderated ratings) is unblocked. */
  readonly rating: { readonly average: number; readonly count: number } | null;
  readonly nextAvailableSlot: NextAvailableSlot | null;
  readonly insurance: InsuranceFlag;
}

