/**
 * The worker-independent bound on refresh-successor retention (ADR-045,
 * RA-045.2).
 *
 * `auth.refresh-successor-sweep` (`auth.jobs.ts`) only fires where
 * `JOBS_ENABLED` is on, and that is legitimately off on every replica of
 * some deployments (PERFORMANCE.md: "`JOBS_ENABLED=false` on all but one";
 * nothing stops it being all of them). A sweep that bounds how long a live
 * refresh token sits encrypted at rest cannot depend on that switch, so
 * **every API instance** runs the same sweep itself:
 *
 *  - once at `onApplicationBootstrap` — which is what clears successors
 *    left behind while no instance was running at all;
 *  - then every `REFRESH_SUCCESSOR_SWEEP_INTERVAL_SECONDS` (5–60 s, default
 *    30) on an `unref`'d timer of its own, ignoring `JOBS_ENABLED` and
 *    `JOBS_DRIVER`.
 *
 * ## Why running it on N instances is safe
 *
 * It is `SessionService.clearLapsedSuccessors`: one `UPDATE` whose
 * predicate is the exact complement of the grace check on the same
 * database clock, so it never touches a successor that can still be
 * honoured, and running it twice clears nothing twice. It claims rows with
 * `FOR UPDATE SKIP LOCKED`, so it never waits on a lock: a row a refresh
 * (or another sweeper) holds is skipped and taken by the next run, and two
 * instances sweeping at once cannot block or deadlock each other.
 *
 * ## Failure and shutdown
 *
 * A failed run is logged and the next tick tries again — it never throws
 * into the event loop. A tick that finds the previous one still running is
 * skipped rather than stacked. `onModuleDestroy` stops the timer, refuses
 * new runs, and waits for one in flight, so no sweep starts during
 * shutdown.
 *
 * Not a `JobRegistry` job on purpose: the registry's whole contract is
 * "registered everywhere, fired where enabled", which is exactly the
 * dependency this exists to remove. The registry job stays — where jobs do
 * fire, a second run of an idempotent sweep is harmless.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { describeError } from '../../../common/logging/error-description';
import { ConfigService } from '../../../config';

import { SessionService } from './session.service';

@Injectable()
export class SuccessorRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('SuccessorRetention');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<number> | null = null;
  private stopped = false;

  constructor(
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  /** The interval actually in force, in milliseconds. */
  get intervalMs(): number {
    return this.config.env.REFRESH_SUCCESSOR_SWEEP_INTERVAL_SECONDS * 1_000;
  }

  /** Whether the periodic timer is armed — for the shutdown spec and the operator. */
  get scheduled(): boolean {
    return this.timer !== null;
  }

  /**
   * The bootstrap sweep, then the timer. The bootstrap run is awaited, so
   * an instance that finishes booting has already cleared whatever lapsed
   * while nothing was running; its failure is logged, never fatal.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.stopped) return;
    await this.tick();
    if (this.stopped) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Never the reason a process stays alive (a CLI context, a test).
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Let a run already in flight finish rather than cut its connection.
    if (this.running !== null) await this.running.catch(() => 0);
  }

  /**
   * One sweep. Resolves to the rows this run cleared — `0` when skipped
   * (stopped, or the previous run still going) or when it failed, which is
   * logged. Never rejects.
   */
  async tick(): Promise<number> {
    if (this.stopped || this.running !== null) return 0;

    this.running = this.sessions
      .clearLapsedSuccessors()
      .then((cleared) => {
        if (cleared > 0) {
          this.logger.debug({ cleared }, 'Cleared lapsed refresh successors');
        }
        return cleared;
      })
      .catch((error: unknown) => {
        this.logger.error(
          { err: describeError(error) },
          'Clearing lapsed refresh successors failed; the next tick retries',
        );
        return 0;
      })
      .finally(() => {
        this.running = null;
      });

    return this.running;
  }
}
