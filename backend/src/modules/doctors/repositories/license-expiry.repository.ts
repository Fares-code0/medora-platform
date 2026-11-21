/**
 * The licence-expiry window query (RM M30.2).
 *
 * A separate repository from `AdminDoctorRepository` rather than a
 * method on it: that one is the roster's, built around pagination,
 * search and the operational columns an administrator's table needs, and
 * a sweep selecting three fields from a date range shares none of it.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

export interface ExpiringLicenceRow {
  readonly doctorId: string;
  readonly userId: string;
  readonly licenseExpiresOn: Date;
}

@Injectable()
export class LicenseExpiryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Practitioners whose licence expires in `(from, to]`.
   *
   * Half-open at the lower end so two adjacent windows — the 60-day band
   * and the 30-day band — cannot both claim a licence that falls exactly
   * on the boundary. The sweep runs the narrower band first and excludes
   * it from the wider one, which is the other half of that rule.
   *
   * `license_expires_on` is a `date`, so the comparison is against dates
   * rather than instants and a licence does not expire at midnight UTC
   * in one place and lunchtime in another.
   */
  expiringBetween(from: Date, to: Date): Promise<ExpiringLicenceRow[]> {
    return this.prisma.db.doctor
      .findMany({
        where: { licenseExpiresOn: { gt: from, lte: to } },
        select: { id: true, userId: true, licenseExpiresOn: true },
        orderBy: { licenseExpiresOn: 'asc' },
      })
      .then((rows) =>
        rows.flatMap((row) =>
          // `licenseExpiresOn` is nullable in the schema and cannot be
          // null here — the `where` excludes it — but narrowing by
          // filtering is what keeps that true if the query ever changes.
          row.licenseExpiresOn === null
            ? []
            : [
                {
                  doctorId: row.id,
                  userId: row.userId,
                  licenseExpiresOn: row.licenseExpiresOn,
                },
              ],
        ),
      );
  }
}
