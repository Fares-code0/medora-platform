/**
 * Authenticated patient discovery (DSC-01, DSC-02, DSC-04; DR-09, OD-10, OD-14).
 *
 * Ordering is deterministic: the requested key, then nulls last, then the
 * doctor's/hospital's name and id. For an **insured** patient the primary key
 * is always "covered first" (OD-14: prioritised, never filtered); an uninsured
 * patient gets the unrestricted list with `insurance: null`.
 *
 * Candidate sets are bounded by the hospital/doctor roster, so filtering,
 * distance and ordering happen in memory over one batched slot lookup and the
 * page is cut afterwards.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ProfilePhotoUrls } from '../../../shared/files';

import type {
  DiscoveryLocation,
  DiscoveryRow,
  InsuranceFlag,
  NextAvailableSlot,
} from './discovery.dto';
import { haversineKm, roundKm, type Coordinates } from './discovery.geo';
import {
  coordinatesOf,
  DiscoveryRepository,
  type LocationRow,
  type SlotRow,
} from './discovery.repository';
import type { DiscoverySearchQuery } from './discovery.schema';

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

interface InsuranceContext {
  /** `null` ⇒ uninsured: unrestricted, no flags. */
  readonly providerId: string | null;
}

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly photos: ProfilePhotoUrls,
  ) {}

  /** Discovery is a patient surface; doctors and administrators are refused. */
  private assertPatient(user: AuthenticatedUser): void {
    if (user.role !== 'patient') throw AppException.forbidden('Patient discovery is for patients');
  }

  private async insuranceFor(user: AuthenticatedUser, now: Date): Promise<InsuranceContext> {
    return { providerId: await this.repository.activeInsuranceProvider(user.id, now) };
  }

  async search(user: AuthenticatedUser, query: DiscoverySearchQuery): Promise<Page<DiscoveryRow>> {
    this.assertPatient(user);
    const now = new Date();
    const insurance = await this.insuranceFor(user, now);
    const doctors = await this.repository.candidateDoctors(query);

    const [slots, covered] = await Promise.all([
      this.repository.nextSlots(
        doctors.map((doctor) => doctor.employment.id),
        now,
      ),
      insurance.providerId === null
        ? Promise.resolve(new Set<string>())
        : this.repository.coveredHospitals(
            [...new Set(doctors.map((doctor) => doctor.employment.hospital.id))],
            insurance.providerId,
            now,
          ),
    ]);

    const rows = doctors.map((doctor) => {
      const { hospital } = doctor.employment;
      const { location, distanceKm } = pickLocation(hospital.locations, query.near, query.locationId);
      const primary =
        doctor.specialties.find((link) => link.isPrimary) ?? doctor.specialties[0] ?? null;

      return {
        photoRef: doctor.photoUrl,
        row: {
          hospital: { id: hospital.id, name: hospital.name },
          clinic: null,
          location,
          doctor: {
            id: doctor.id,
            fullName: doctor.fullName,
            title: doctor.title,
            photoUrl: doctor.photoUrl,
            yearsOfExperience: doctor.yearsOfExperience,
            languages: doctor.languages,
          },
          specialty: { id: primary?.specialty.id ?? null, name: doctor.specialty },
          department: doctor.employment.department,
          distanceKm: distanceKm === null ? null : roundKm(distanceKm),
          rating: null,
          nextAvailableSlot: slotView(slots.get(doctor.employment.id), hospital.timezone),
          insurance: flag(insurance, covered, hospital.id),
        } satisfies DiscoveryRow,
        sortDistance: distanceKm,
      };
    });

    const sort = query.sort ?? (query.near === undefined ? 'nextAvailable' : 'distance');
    rows.sort((a, b) =>
      compose(
        coveredFirst(a.row.insurance, b.row.insurance),
        sortKey(sort, a.sortDistance, b.sortDistance, a.row.nextAvailableSlot, b.row.nextAvailableSlot),
        a.row.doctor.fullName.localeCompare(b.row.doctor.fullName),
        a.row.doctor.id.localeCompare(b.row.doctor.id),
      ),
    );

    const slice = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const photo = await this.photos.lookup(slice.map((entry) => entry.photoRef));

    return paged(
      slice.map(({ row }) => ({ ...row, doctor: { ...row.doctor, photoUrl: photo(row.doctor.photoUrl) } })),
      query,
      rows.length,
    );
  }
}

function flag(insurance: InsuranceContext, covered: ReadonlySet<string>, hospitalId: string): InsuranceFlag {
  return insurance.providerId === null ? null : { covered: covered.has(hospitalId) };
}

function slotView(slot: SlotRow | undefined, timezone: string): NextAvailableSlot | null {
  return slot === undefined
    ? null
    : {
        slotId: slot.slotId,
        startsAt: slot.startsAt.toISOString(),
        durationMinutes: slot.durationMinutes,
        timezone,
      };
}

function distanceTo(location: LocationRow, near: Coordinates | undefined): number | null {
  if (near === undefined) return null;
  const at = coordinatesOf(location);
  return at === null ? null : haversineKm(near, at);
}

/**
 * The location shown for a hospital: the pinned one if `locationId` was
 * filtered, else the nearest with coordinates, else the first by name.
 */
function pickLocation(
  locations: readonly LocationRow[],
  near: Coordinates | undefined,
  locationId: string | undefined,
): { location: DiscoveryLocation | null; distanceKm: number | null } {
  const scored = locations
    .filter((location) => locationId === undefined || location.id === locationId)
    .map((location) => ({ location, distance: distanceTo(location, near) }));

  const chosen =
    scored
      .filter((entry) => entry.distance !== null)
      .sort((a, b) => (a.distance as number) - (b.distance as number))[0] ?? scored[0];

  if (chosen === undefined) return { location: null, distanceKm: null };

  const { location } = chosen;
  return {
    location: {
      id: location.id,
      name: location.name,
      addressLine1: location.addressLine1,
      addressLine2: location.addressLine2,
      city: location.city,
      region: location.region,
      countryCode: location.countryCode,
    },
    distanceKm: chosen.distance,
  };
}

const compose = (...diffs: number[]): number => diffs.find((diff) => diff !== 0) ?? 0;

/** Insured patients: covered rows first. Uninsured (`null`): no effect. */
function coveredFirst(a: InsuranceFlag, b: InsuranceFlag): number {
  if (a === null || b === null) return 0;
  return Number(b.covered) - Number(a.covered);
}

function sortKey(
  sort: 'distance' | 'nextAvailable' | 'name',
  distanceA: number | null,
  distanceB: number | null,
  slotA: NextAvailableSlot | null,
  slotB: NextAvailableSlot | null,
): number {
  if (sort === 'name') return 0;
  if (sort === 'distance') return nullsLast(distanceA, distanceB);
  return nullsLast(
    slotA === null ? null : Date.parse(slotA.startsAt),
    slotB === null ? null : Date.parse(slotB.startsAt),
  );
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function paged<T>(items: readonly T[], query: { page: number; pageSize: number }, total: number): Page<T> {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    totalItems: total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}
