/**
 * AI usage-log retention (RM M30.2) — registered, blocked, and the
 * blocker is a design decision rather than a missing piece.
 *
 * M30.2 lists "AI usage-log retention (M16.1)". M16.1's own answer to
 * "log prompts and completions under PHI rules" was to log **neither**:
 * `ai-transcript.log.ts` records shape and cost — character counts, a
 * duration, an outcome, and one boolean for whether a patient was
 * bound — and puts the text nowhere but `ai_messages`, inside the
 * database, under the same care scoping and the same soft delete as the
 * rest of the chart.
 *
 * That leaves nothing in this platform for a retention job to purge:
 *
 * · The **operational** record is a pino line in the log stream.
 *   `AI_LOG_RETENTION_DAYS` rides on every one of them precisely so the
 *   log pipeline can expire them independently — "so a log pipeline can
 *   expire these independently of everything else in the stream". A job
 *   in this process cannot delete a line that has already been shipped
 *   to a collector, and one that tried would be deleting the wrong copy.
 * · The **durable** record is `ai_messages`, which is chart content.
 *   Purging it is not AI-log retention at all; it is clinical retention,
 *   it is governed by ADR-007, and ADR-007's `autoPurge` is **false** —
 *   "retention expiry deletes nothing unless an administrator turns it
 *   on".
 *
 * So the slot is declared with its reason rather than filled with a job
 * that would delete either nothing or the wrong thing. 03:40 UTC is the
 * slot it would take, between the audit retention sweep and the licence
 * warning.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { dailyAtUtc, JobRegistry } from '../../../shared/jobs';

@Injectable()
export class AiJobs implements OnModuleInit {
  constructor(private readonly registry: JobRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'ai.usage-log-retention',
      summary: 'Expires AI usage logs past their retention period (M16.1).',
      schedule: dailyAtUtc(3, 40),
      blocked: {
        reason:
          'There is nothing in the platform to purge: M16.1 logs shape and cost to the log stream, where `AI_LOG_RETENTION_DAYS` is the pipeline’s to enforce, and the transcript itself lives in `ai_messages` under ADR-007, whose `autoPurge` is off.',
        unblockedBy: 'A log-pipeline retention rule (deployment), or ADR-007 enabling auto-purge',
      },
    });
  }
}
