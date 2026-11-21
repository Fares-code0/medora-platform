/**
 * The operator's view of the job registry (RM M30.1).
 *
 * ## Why this is a Medora route and not Bull Board
 *
 * M30.1 names "Bull Board (admin-only)". It is not mounted, and the
 * reason is the *admin-only* half rather than the board:
 *
 * · Bull Board is an Express application mounted beside this one. Its
 *   own authorization is a middleware the host supplies, so the platform
 *   would have two independent answers to "is this caller an
 *   administrator" — this repository's `AuthorizationGuard`, and
 *   whatever the mount is wired with. A healthcare platform with two
 *   auth paths has the weaker one.
 * · It shows only what is in Redis, so on the default `inline` driver it
 *   would show nothing at all while eleven schedules ran.
 * · It cannot show a **blocked** schedule, because a blocked schedule is
 *   this registry's concept and never reaches a broker — and four of
 *   the eleven are blocked, which is the single most useful thing on
 *   this screen.
 *
 * So the same information is served by a guarded route: the registry, the
 * next firing, the counters, the dead letters, and the two actions. An
 * operator who wants the broker's own view runs Bull Board against the
 * same Redis out of band, where it is a read of infrastructure rather
 * than a second door into the API. Recorded as ADR-041 §3.
 *
 * ## Nothing here can carry clinical content
 *
 * A job outcome is scalars by contract, a dead letter keeps a bounded
 * message and no stack, and a summary is prose written in this
 * repository. The screen is therefore safe for an administrator who
 * holds no PHI capability, which is what lets it live under the
 * role-guarded Administration Center rather than behind a new one.
 */

/** One registered schedule, runnable or not. */
export interface JobView {
  readonly name: string;
  readonly summary: string;
  /** e.g. `every 15 min`, `daily at 03:10 UTC`. */
  readonly schedule: string;
  readonly state: 'runnable' | 'blocked';
  /** Present only when `state` is `blocked`. */
  readonly blocked?: { readonly reason: string; readonly unblockedBy: string };
  /** Null for a blocked job — it is never enqueued. */
  readonly nextRunAt: string | null;
  readonly retry: { readonly attempts: number; readonly backoff: string } | null;
  readonly metrics: JobMetricsView;
}

export interface JobMetricsView {
  readonly started: number;
  readonly succeeded: number;
  readonly failedAttempts: number;
  readonly deadLettered: number;
  readonly lastRunAt: string | null;
  readonly lastDurationMs: number | null;
  readonly lastOutcome: Readonly<Record<string, string | number | boolean | null>> | null;
  readonly lastError: string | null;
}

export interface JobsView {
  readonly driver: 'inline' | 'bullmq';
  /** False when this instance registers the schedules but never fires. */
  readonly enabled: boolean;
  /**
   * True while the counters and the dead-letter list come from this
   * process alone (RA-M30.1). Stated rather than left to be inferred: an
   * empty dead-letter list means "none here", not "none".
   */
  readonly processLocal: boolean;
  readonly jobs: readonly JobView[];
}

export interface DeadLetterView {
  readonly id: string;
  readonly job: string;
  readonly failedAt: string;
  readonly attempts: number;
  readonly error: string;
  readonly correlationId: string;
  readonly trigger: string;
}

/** What `POST …/run` and `POST …/dead-letters/{id}/replay` answer. */
export interface JobTriggerView {
  readonly job: string;
  readonly accepted: true;
}
