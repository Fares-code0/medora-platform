/**
 * Licence-expiry warnings (RM M30.2).
 *
 * > M30.2: "license-expiry warnings (**<60/<30 days**)".
 *
 * ## Two bands, and a licence is only ever in one of them
 *
 * The narrower band is computed first and the wider one excludes it, so
 * a licence 20 days out produces the 30-day warning and not both. Warning
 * twice on one day is how a recipient learns to ignore the warning.
 *
 * ## The warning is published, not sent
 *
 * The sweep writes an outbox message and stops. Reaching into the
 * notifications module would break M2.2's zone 1, and reaching into the
 * mail kernel would put this module's own opinion about delivery ahead
 * of the recipient's channel preferences — which M19.4 made the user's
 * to set. `NOTIFICATION_RULES` decides who hears about
 * `doctor.license_expiring` and through which channels.
 *
 * ## Running it twice in a day sends one warning
 *
 * `dedupeKey` names the doctor, the band and the expiry date, so a
 * re-run, a second replica or a manual trigger all resolve to the same
 * message. Delivery is at-least-once by design — `OutboxMessage` says so
 * — and this is the key that makes redelivery harmless.
 *
 * ## Days are counted on the date, not on the clock
 *
 * `license_expires_on` is a SQL `date`. Comparing it against an instant
 * would make a licence expiring "in 30 days" fall inside the band or
 * outside it depending on the time of day the sweep happened to run.
 * Both ends of every window are therefore snapped to UTC midnight.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import { LicenseExpiryRepository } from '../repositories/license-expiry.repository';

/** The two bands M30.2 names, widest last. */
export const WARNING_BANDS = [30, 60] as const;

export type WarningBand = (typeof WARNING_BANDS)[number];

/** The topic `NOTIFICATION_RULES` routes. */
export const LICENSE_EXPIRING_TOPIC = 'doctor.license_expiring';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LicenseWarningResult {
  /** How many warnings were published, per band. */
  readonly warned: Readonly<Record<string, number>>;
  readonly total: number;
}

@Injectable()
export class LicenseExpiryService {
  private readonly logger = new Logger(LicenseExpiryService.name);

  constructor(
    private readonly licences: LicenseExpiryRepository,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async sweep(now: Date): Promise<LicenseWarningResult> {
    const today = startOfUtcDay(now);
    const warned: Record<string, number> = {};
    let total = 0;
    // The lower edge of the next band up. The first band starts at
    // today, so a licence that has already expired is not warned about —
    // that is a verification problem, not a reminder.
    let lowerBound = today;

    for (const band of WARNING_BANDS) {
      const upperBound = new Date(today.getTime() + band * DAY_MS);
      const rows = await this.licences.expiringBetween(lowerBound, upperBound);

      for (const row of rows) {
        const expiresOn = row.licenseExpiresOn.toISOString().slice(0, 10);

        await this.outbox.publish({
          topic: LICENSE_EXPIRING_TOPIC,
          payload: {
            doctorId: row.doctorId,
            userId: row.userId,
            expiresOn,
            withinDays: band,
          },
          dedupeKey: `license-expiry:${row.doctorId}:${String(band)}:${expiresOn}`,
        });
      }

      warned[String(band)] = rows.length;
      total += rows.length;
      lowerBound = upperBound;
    }

    if (total > 0) {
      this.logger.log(
        { warned, at: now.toISOString() },
        'Published licence-expiry warnings',
      );
    }

    return { warned, total };
  }
}

/** Midnight UTC on the day of `at`. See the header. */
function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
