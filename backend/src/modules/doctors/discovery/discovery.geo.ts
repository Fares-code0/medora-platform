/**
 * Distance helpers for patient discovery (DSC-02).
 *
 * The patient's position arrives **per request** (`near=lat,lng`) and is
 * used only to compute a number that is returned and then forgotten: it is
 * never stored, logged or attached to a row.
 */

const EARTH_RADIUS_KM = 6371.0088;

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometres (haversine). */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** One decimal place, the precision a patient can act on. */
export const roundKm = (km: number): number => Math.round(km * 10) / 10;
