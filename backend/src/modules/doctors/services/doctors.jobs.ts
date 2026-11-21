/**
 * The licence-expiry schedule (RM M30.2).
 *
 * 06:00 UTC: a warning is read by a person, so it wants to arrive at the
 * start of a working day rather than at 02:00 with the sweeps. It is
 * also the last of the four daily jobs, which keeps the small hours for
 * the two that touch a lot of rows.
 *
 * Daily is the only sensible cadence — the bands are counted in whole
 * days, so a licence can cross a boundary at most once per day, and the
 * outbox `dedupeKey` makes a second run on the same day a no-op anyway.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { dailyAtUtc, DEFAULT_RETRY, JobRegistry } from '../../../shared/jobs';

import { LicenseExpiryService } from './license-expiry.service';

@Injectable()
export class DoctorsJobs implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly licences: LicenseExpiryService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'doctors.license-expiry-warning',
      summary: 'Warns a practitioner and the administrators 60 and 30 days before a licence lapses.',
      schedule: dailyAtUtc(6, 0),
      retry: DEFAULT_RETRY,
      timeoutMs: 5 * 60_000,
      handler: async ({ now }) => {
        const result = await this.licences.sweep(now);

        return {
          total: result.total,
          within30Days: result.warned['30'] ?? 0,
          within60Days: result.warned['60'] ?? 0,
        };
      },
    });
  }
}
