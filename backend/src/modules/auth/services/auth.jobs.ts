/**
 * The auth schedule (ADR-045, RA-045.1).
 *
 * `sessions.successor_token_ct` is honoured for 30 seconds after a
 * rotation, but nothing else removes it until the session rotates again
 * or is revoked — so an idle session would keep its live refresh token at
 * rest, encrypted, for the rest of its lifetime. This sweep bounds that to
 * the window plus one interval — **where jobs fire**. It is not what the
 * bound rests on: `JOBS_ENABLED` may be off everywhere, so
 * `SuccessorRetentionService` runs the same sweep on every instance
 * regardless (RA-045.2). This job stays because a duplicate run of an
 * idempotent `UPDATE` is harmless.
 *
 * Every minute, the finest grid `everyMinutes` offers: the window is half
 * a minute, so anything coarser would let the exposure at rest dwarf the
 * window the owner approved. The `UPDATE` touches only rows the partial
 * index `sessions_successor_rotated_at_idx` names, so a run that finds
 * nothing costs an index probe, not a scan of `sessions`.
 *
 * `FREQUENT_RETRY` for the reason `files.malware-scan` uses it: the next
 * minute's run does the same work, so retrying hard buys nothing.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { everyMinutes, FREQUENT_RETRY, JobRegistry } from '../../../shared/jobs';

import { SessionService } from './session.service';

@Injectable()
export class AuthJobs implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly sessions: SessionService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'auth.refresh-successor-sweep',
      summary: 'Drops encrypted refresh successors whose 30 s grace window has closed (ADR-045).',
      schedule: everyMinutes(1),
      retry: FREQUENT_RETRY,
      timeoutMs: 60_000,
      // The job's `now` is deliberately unused: the predicate is evaluated
      // on the database clock, the one the grace check itself uses.
      handler: async () => ({ cleared: await this.sessions.clearLapsedSuccessors() }),
    });
  }
}
