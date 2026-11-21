/**
 * The scheduled-report executor's slot (RM M30.2) — registered, blocked.
 *
 * > API §12.4: "executor is a cron job; failures notify."
 *
 * M30.2 lists scheduled reports and this milestone owns the executor, so
 * the schedule is declared. It is declared **blocked**, because the run
 * cannot be recorded honestly today and the reason is a column rather
 * than an opinion.
 *
 * ## `run_status` has two values, and neither is true
 *
 * `ScheduledReportRun.status` is `sent | failed` (DB §I2). An executor
 * that generated a document and filed the run as `sent` would be
 * asserting a delivery that did not happen; one that filed every run as
 * `failed` would fill `GET /reports/scheduled/{id}/runs` — the history a
 * doctor reads to see whether their weekly report is working — with a
 * daily row describing a platform limitation rather than a failure of
 * their schedule.
 *
 * ## Nothing can carry the document to `recipients`
 *
 * Two independent gaps, both outside this milestone:
 *
 * · **The mail port carries no attachments.** `MailMessage` is `to`,
 *   `subject`, `text`, `html` and says so deliberately — "no
 *   attachments, no template ids … a wider port now would be guesswork"
 *   (ADR-025). `recipients` is a list of email addresses, not user ids,
 *   so the in-app feed is not an alternative for them.
 * · **A link would point at a closed door.** An artefact in object
 *   storage is reachable only through the download surface, and M25.3's
 *   gate refuses every file whose `scan_result` is not `clean` — which,
 *   with no scan engine bound, is all of them.
 *
 * ## What *is* built, and where
 *
 * The pieces the executor will compose already exist and are tested:
 * `SnapshotService` builds the payload, `ReportExportService.toCsv`
 * serialises it, `FILE_STORAGE.put` stores it and `report_exports` is
 * the row ADR-010 group 15 scoped in for the artefact. What is missing
 * is only the delivery, and `ReportExportService` already answers 501
 * `not_implemented` on the same two formats for the same reason.
 * Unblocking is: widen `MailMessage` (or bind a scan engine so a signed
 * link works), then replace this registration with a handler.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { everyMinutes, JobRegistry } from '../../../shared/jobs';

@Injectable()
export class ReportsJobs implements OnModuleInit {
  constructor(private readonly registry: JobRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'reports.scheduled-run',
      summary: 'Runs the scheduled reports whose next_run_at has passed (API §12.4).',
      // Declared at the cadence the executor will need: `next_run_at` is
      // a per-schedule timestamp, so the job has to wake often enough to
      // honour a daily schedule at the minute it was created.
      schedule: everyMinutes(15),
      blocked: {
        reason:
          'The run cannot be recorded honestly: `run_status` is `sent | failed`, and nothing can deliver the document to `recipients` — `MailMessage` carries no attachments (ADR-025) and a download link is refused by the M25.3 scan gate.',
        unblockedBy: 'A delivery path: attachments on the mail port, or a bound scan engine',
      },
    });
  }
}
