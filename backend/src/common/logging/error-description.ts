/**
 * What a log line says about an error (MG §11.6, RM M37.3).
 *
 * ## Why this exists: `{ "err": {} }`
 *
 * Handing a raw exception to a logger that serialises own-properties
 * produced exactly that for every unhandled 500. `Error.message` and
 * `Error.stack` are **non-enumerable**, so the one class of failure the
 * exception filter exists to make investigable recorded nothing about
 * its cause.
 *
 * ## Why the message is not always included
 *
 * MG §11.6 forbids PHI in logs, and a database driver's message can echo
 * the row it choked on — `Failing row contains (…, 'Khaled Nassar', …)`.
 * So the message is included for an ordinary `Error`, whose text is
 * written by us or by Node ("Connection terminated unexpectedly"), and
 * **withheld for a Prisma error**, whose `code` is the diagnostic part
 * and whose message is the part that can carry data. Both cases carry
 * `name` and `stack`: a stack is code paths, never patient data, and it
 * is what turns "something threw" into a line number.
 *
 * ## Why `type` and `errorCode`, not `name` and `code`
 *
 * `redaction.ts` censors `name` (an identifier) and `code` (an OTP)
 * one level down in every logged object, `err` included — and a pino
 * wildcard cannot exempt one container. Under those keys the class and
 * the driver code of every 5xx reached the log store as `[redacted]`,
 * which is the diagnostic half of the line. These two keys are on no
 * redaction list, and `type` is what pino's default serialiser calls the
 * class anyway.
 *
 * ## Why nothing else is copied
 *
 * pino's default error serialiser copies every enumerable property, and
 * that is where the row actually was. A failed Prisma write carries
 * `meta.driverAdapterError.cause.detail` — Postgres's `DETAIL` line,
 * `Failing row contains (…, khaled.nassar@example.com, …)` — which no
 * redaction path matches, because redaction is by key and `detail` is
 * not a key anyone would think to list. Observed against the real
 * adapter on 2026-10-30, from `LoginEventService`'s catch block. An
 * allow-list of four fields cannot grow a leak when a library adds one.
 */
export interface DescribedError {
  /** The error's class — pino's own name for this field. */
  readonly type: string;
  readonly message?: string;
  readonly errorCode?: string;
  readonly stack?: string;
}

export function describeError(exception: unknown): DescribedError | { readonly thrown: string } {
  if (!(exception instanceof Error)) {
    // Something threw a non-Error — a string, a plain object, a
    // rejection with no reason. Naming the type is what makes that
    // diagnosable at all.
    return { thrown: typeof exception };
  }

  const code = (exception as { code?: unknown }).code;
  // Prisma's known-request errors are the ones whose message can echo a
  // row. Identified by shape rather than by importing the client: this
  // file is `common/`, the bottom of the stack, and may not import the
  // database kernel (lint zone 4).
  const isPrismaError = exception.name.startsWith('Prisma');

  const stack = isPrismaError ? framesOf(exception.stack) : exception.stack;

  return {
    type: exception.name,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
    ...(isPrismaError ? {} : { message: exception.message }),
    ...(stack === undefined ? {} : { stack }),
  };
}

/**
 * pino's `err` serialiser.
 *
 * pino-http wraps a custom error serialiser *after* its own, so this
 * receives pino's copy — every enumerable property already spread onto
 * it — with the original on the documented, non-enumerable `raw`. The
 * original is what gets described; the copy is discarded. Anything that
 * was never an `Error` (a value a call site has already reduced, such as
 * the exception filter's own description) is logged as it was given —
 * pino treats any object with a string `message` as error-like and would
 * otherwise overwrite its `type` with `Object`.
 */
export function serializeLoggedError(value: unknown): unknown {
  const original =
    typeof value === 'object' && value !== null && 'raw' in value ? value.raw : value;

  return original instanceof Error ? describeError(original) : original;
}

/**
 * The frames of a stack, without its first line.
 *
 * `Error.prototype.stack` **begins with `Name: message`**, so withholding
 * the message and keeping the stack withholds nothing — which is what the
 * exception filter's spec caught on the first run, with a driver message
 * carrying a patient's name straight into the log through the stack it
 * was supposed to be excluded from. Dropping everything before the first
 * frame keeps the line numbers and loses the text.
 */
function framesOf(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;

  const firstFrame = stack.indexOf('\n    at ');

  return firstFrame === -1 ? undefined : stack.slice(firstFrame + 1);
}
