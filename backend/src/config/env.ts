import { config as loadDotenv } from 'dotenv';

import { type Env, productionEnvSchema } from './env.schema';

/**
 * Parses and validates the environment exactly once (RM M3.1).
 *
 * The single most important property here is *when* this runs: before
 * the Nest container is created, so a missing variable produces the
 * message below rather than a DI stack trace forty frames deep that
 * never names the variable.
 */

/**
 * Thrown when the environment does not satisfy the contract. Carries the
 * per-variable issues so the message can name every problem at once —
 * fixing one variable per restart is a miserable way to configure a
 * service.
 */
export class EnvValidationError extends Error {
  constructor(readonly issues: ReadonlyArray<{ variable: string; message: string }>) {
    super(formatIssues(issues));
    this.name = 'EnvValidationError';
  }
}

function formatIssues(issues: ReadonlyArray<{ variable: string; message: string }>): string {
  const lines = issues.map(({ variable, message }) => `  ${variable} — ${message}`);
  return [
    'Invalid environment configuration:',
    ...lines,
    '',
    'Copy backend/.env.example to backend/.env and fill in the values above.',
  ].join('\n');
}

let cached: Env | undefined;

/**
 * Reads `.env` into `process.env`, for developer convenience only.
 *
 * Called once from `main.ts` before anything validates, and **not** from
 * `loadEnv()`. Keeping the two apart matters for a reason that is easy
 * to miss: if reading the file were part of validation, then anything
 * that re-validated would re-read it, and a caller that had deliberately
 * constructed an environment — a test, a script — would find the file's
 * values reappearing underneath. Loading the file is a bootstrap step;
 * validating what is loaded is a separate one.
 *
 * `.env` **never overrides a variable already set**. In a container the
 * orchestrator's environment is the truth, and a stale `.env` baked into
 * an image must not quietly win over it. That is `dotenv`'s default
 * behaviour; it is stated here because it is load-bearing.
 */
export function loadDotenvFile(): void {
  loadDotenv({ quiet: true });
}

/**
 * Returns the validated environment, parsing on first call.
 *
 * Memoised because several places need it — `main.ts` before bootstrap,
 * the logger factory, the config provider — and parsing three times
 * could otherwise yield three different answers if something mutated
 * `process.env` in between.
 */
export function loadEnv(): Env {
  if (cached !== undefined) return cached;

  const result = productionEnvSchema.safeParse(process.env);

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        // Every issue in this schema is keyed by a single env variable.
        variable: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }

  cached = Object.freeze(result.data);
  return cached;
}

/**
 * Drops the memoised value. Tests that assert validation behaviour need
 * this; nothing in `src/` should call it.
 */
export function resetEnvForTesting(): void {
  cached = undefined;
}
