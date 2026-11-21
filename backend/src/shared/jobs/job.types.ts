/**
 * The background-job contract (RM M30.1, MG §17).
 *
 * ## Why this is a kernel and not a module
 *
 * Nine of the eleven schedules M30.2 names belong to a different domain
 * module — prescription expiry to pharmacy, retention to audit, orphan
 * cleanup to files — and M2.2's boundary rule forbids any of them from
 * importing another. A scheduler that lived in one module could only
 * reach the other eight by breaking that rule. So the registry sits
 * below all of them and each module *registers into it*, which keeps
 * every arrow pointing the same way: module → kernel, never back.
 *
 * It is the shape `shared/outbox` already predicted — "the consumers are
 * M19's channels and M30's workers" — and the one `shared/audit` wrote
 * into its own actor type: "`null` is the system itself — a scheduled
 * job, a retention sweep, an outbox worker".
 *
 * ## A job reports numbers, never rows
 *
 * `JobOutcome` is scalars only, for the same reason `OutboxPayload` and
 * `AuditMetadata` are: an outcome is logged and shown to an
 * administrator, and a sweep that returned the rows it touched would put
 * clinical identifiers into both (MG §11.6, DB §10). Counts and
 * durations answer every operational question a job outcome is asked.
 *
 * ## Blocked jobs are declared, not omitted
 *
 * M30.2's verify step is "each schedule **registered and visible**", and
 * four of the schedules it lists have no work behind them yet — the
 * scheduled-report executor has no delivery path, the backup runner has
 * no artefact pipeline, no route exists to submit a satisfaction survey,
 * and the AI usage log is a log stream rather than a table. Leaving them
 * out would make the registry look complete; registering them with a
 * handler that does nothing would make the operator's screen lie. So the
 * definition is a union: a job either has a handler or has a `blocked`
 * reason, and the type makes it impossible to run one that does not.
 */

/**
 * What one run produced. Scalars only — see the header.
 *
 * Deliberately the same shape as `OutboxPayload` and `AuditMetadata`, so
 * an outcome can be logged, audited or published without a conversion
 * that could widen it.
 */
export type JobOutcome = Readonly<Record<string, string | number | boolean | null>>;

/** Why a run happened. Carried through logs, metrics and dead letters. */
export type JobTrigger = 'schedule' | 'manual' | 'replay';

/**
 * What a handler is given.
 *
 * `now` is passed rather than read, which is the rule every sweep in
 * this repository was already written to: `PrescriptionSweepService`,
 * `AuditRetentionService` and the license sweep all take their clock as
 * an argument so that "the license warning fires at 60 days" is a test
 * of the job rather than of the system clock.
 */
export interface JobContext {
  readonly now: Date;
  /** 1-based. A handler may log it; it must not branch on it. */
  readonly attempt: number;
  readonly trigger: JobTrigger;
  /** Ties the run's log lines and audit rows together (API §0.1). */
  readonly correlationId: string;
}

export type JobHandler = (context: JobContext) => Promise<JobOutcome>;

/**
 * How many times a failure is retried, and how long between attempts.
 *
 * `attempts` counts the *total* tries, not the retries after the first —
 * `attempts: 1` means no retry at all, which is the reading that makes
 * "a poisoned job lands in the DLQ after N retries" unambiguous.
 */
export interface RetryPolicy {
  readonly attempts: number;
  readonly backoff: 'fixed' | 'exponential';
  /** The first delay. Exponential doubles it per subsequent attempt. */
  readonly delayMs: number;
  /**
   * The ceiling. Without one an exponential policy with a generous
   * `attempts` sleeps for hours between the last two tries, and the job
   * that was meant to recover in minutes recovers tomorrow.
   */
  readonly maxDelayMs: number;
}

/**
 * When a job runs.
 *
 * Two forms, and deliberately not cron. Every schedule M30.2 lists is
 * either "every N minutes" or "once a day", so a cron parser would be a
 * dependency and a second date implementation bought for expressiveness
 * nothing asks for. `dailyAtUtc` is UTC rather than clinic-local because
 * a schedule that shifts twice a year is a schedule that runs twice on
 * one day and not at all on another.
 */
export type JobSchedule =
  | { readonly kind: 'every'; readonly ms: number }
  | { readonly kind: 'dailyAtUtc'; readonly hour: number; readonly minute: number };

/** Why a declared schedule cannot run, and what would let it. */
export interface JobBlocker {
  readonly reason: string;
  /** The milestone or capability that unblocks it, e.g. `M25.3`. */
  readonly unblockedBy: string;
}

interface JobCommon {
  /** Dotted `domain.job`, e.g. `audit.retention-sweep`. Unique. */
  readonly name: string;
  /** One line an operator reads on the jobs screen. */
  readonly summary: string;
  readonly schedule: JobSchedule;
}

export interface RunnableJob extends JobCommon {
  readonly retry: RetryPolicy;
  /**
   * How long one attempt may take before it is abandoned and retried.
   *
   * A sweep that hangs on a lock would otherwise hold its queue for
   * ever, and the next scheduled tick would pile a second one behind it.
   */
  readonly timeoutMs: number;
  readonly handler: JobHandler;
}

export interface BlockedJob extends JobCommon {
  readonly blocked: JobBlocker;
}

export type JobDefinition = RunnableJob | BlockedJob;

/**
 * The narrowing every caller uses.
 *
 * It tests for a **callable handler** rather than for the absence of
 * `blocked`, because that is the question every caller actually has:
 * there is nothing to run without one, whatever else the object says. A
 * definition carrying neither — which the union forbids and a cast could
 * still produce — is therefore never runnable.
 */
export function isRunnable(job: JobDefinition): job is RunnableJob {
  return 'handler' in job && typeof job.handler === 'function';
}

/**
 * A run that exhausted its retries.
 *
 * `error` is the failure's **message**, never its stack and never the
 * value that caused it: a dead letter is shown to an administrator on
 * the jobs screen, and a stack trace from a clinical sweep names rows.
 */
export interface DeadLetter {
  readonly id: string;
  readonly job: string;
  readonly failedAt: Date;
  readonly attempts: number;
  readonly error: string;
  readonly correlationId: string;
  readonly trigger: JobTrigger;
}

/** Per-job counters, since boot. */
export interface JobMetrics {
  readonly job: string;
  readonly started: number;
  readonly succeeded: number;
  /** Attempts that threw, including those a later attempt recovered. */
  readonly failedAttempts: number;
  readonly deadLettered: number;
  readonly lastRunAt: Date | null;
  readonly lastDurationMs: number | null;
  readonly lastOutcome: JobOutcome | null;
  /** The most recent failure's message, or null if none since boot. */
  readonly lastError: string | null;
}

/**
 * The queue driver.
 *
 * A port for the reason ADR-019 §2 gives for every other kernel: the
 * in-process driver and the BullMQ driver are two answers to "where does
 * a due job actually run", and no caller should be able to tell which is
 * bound. `JobRegistry`, `JobRunner` and the administration surface are
 * written against this and nothing else.
 */
export interface JobQueuePort {
  readonly driver: 'inline' | 'bullmq';
  /**
   * Hands a job to the driver. Resolves when the driver has **accepted**
   * it, not when the handler finished — a caller that awaited completion
   * would turn a background job into a synchronous request.
   */
  enqueue(name: string, trigger: JobTrigger): Promise<void>;
  /** Begins consuming, and registers the repeatable schedules. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** DI token — inject the interface, never a concrete class. */
export const JOB_QUEUE = Symbol('JOB_QUEUE');
