/**
 * The prescription expiry and refill-due schedule (RM M30.2).
 *
 * `PrescriptionSweepService` states the division this file completes:
 * "this milestone owns the *sweep*; M30 owns *when it runs*". Nothing
 * about the sweep changes here — it is registered, and the registry
 * calls it with the clock it already takes as an argument.
 *
 * ## Once a day, at 02:00 UTC
 *
 * Expiry is a date comparison (ADR-002 §3: past `end_date`), so it
 * changes at most once per prescription per day and running it more
 * often would re-select the same rows to find nothing. Early, so a
 * prescriber signing in at the start of a clinic sees the status the
 * course actually has rather than yesterday's.
 *
 * ## No refill window is passed, and that is PD-13.5
 *
 * `SweepOptions.refillDueWindowDays` has no default *by design* — the
 * service's own header is explicit that no source in this repository
 * states the number, and that a constant invented here "is not a policy,
 * it is a policy nobody can change without a deploy". Omitting it here
 * keeps that true: the expiry half runs, the refill half reports
 * `refillDueWindowDays: null`, and the outcome on the operator's screen
 * says so rather than reading as "no prescriptions were due".
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { dailyAtUtc, DEFAULT_RETRY, JobRegistry } from '../../../shared/jobs';

import { PrescriptionSweepService } from './prescription-sweep.service';

@Injectable()
export class PrescriptionJobs implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly sweep: PrescriptionSweepService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'pharmacy.prescription-expiry-sweep',
      summary: 'Expires prescriptions past their end date and flags refills due (M13.5).',
      schedule: dailyAtUtc(2, 0),
      retry: DEFAULT_RETRY,
      timeoutMs: 5 * 60_000,
      handler: async ({ now }) => {
        const result = await this.sweep.sweep(now);

        return {
          expired: result.expired.length,
          refillDue: result.refillDue.length,
          refillDueWindowDays: result.refillDueWindowDays,
        };
      },
    });
  }
}
