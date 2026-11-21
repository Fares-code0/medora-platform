/**
 * The redacting logger.
 *
 * Mirrors `backend/src/common/logging/redaction.ts` in intent: a field
 * whose name is on the deny-list never reaches an output sink, whatever
 * its value. This is checklist T-04, and it is not a nicety — a crash
 * report containing a patient's name, diagnosis or result value is a
 * disclosure to whoever operates the crash service.
 *
 * ── The two rules ────────────────────────────────────────────────────
 *
 * 1. **Nothing in this app calls `console.*` directly.** ESLint enforces
 *    it; this file is the single exception. A `console.log(patient)` in a
 *    screen is a PHI leak that lints clean everywhere else.
 * 2. **Free text is never logged.** Only a message the developer wrote
 *    plus a redacted context object. A server `detail` string, a message
 *    body, a note — all of these can contain PHI and none of them may be
 *    passed through, which is why `log()` takes a fixed message and a
 *    record rather than a rest parameter.
 *
 * Crash reporting (W-04) registers here as a sink — see `addLogSink`
 * below and `src/utils/monitoring.ts`. It is deliberately not wired up
 * alongside `console`: a sink attached there would see the arguments
 * before `redact()` ran, which is the bypass this file exists to prevent
 * in the one consumer that most needs it.
 */

/**
 * Field names that may never appear in a log line. Matched
 * case-insensitively against the whole key, and against a key containing
 * one of them as a word part (`patientName`, `dob`, `result_value`).
 *
 * The list is deliberately over-broad. A false positive costs a `[redacted]`
 * in a developer's console; a false negative costs a disclosure.
 */
const REDACTED_KEY_PARTS: readonly string[] = [
  'name',
  'email',
  'phone',
  'address',
  'dob',
  'birth',
  'mrn',
  'ssn',
  'nationalid',
  'passport',
  'insurance',
  'diagnosis',
  'allergy',
  'allergen',
  'condition',
  'medication',
  'prescription',
  'dose',
  'dosage',
  'result',
  'lab',
  'note',
  'notes',
  'reason',
  'symptom',
  'body',
  'message',
  'content',
  'attachment',
  'token',
  'password',
  'secret',
  'authorization',
  'credential',
  'otp',
  'photo',
  'avatar',
  'gender',
  'bloodtype',
  'contact',
];

const REDACTION = '[redacted]';
const MAX_DEPTH = 4;

function keyIsSensitive(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return REDACTED_KEY_PARTS.some((part) => normalized.includes(part));
}

/**
 * Redacts a value for logging. Exported because the test that proves the
 * guarantee (`logger.test.ts`) asserts on it directly, and because a
 * future crash-reporting sink must run its payloads through the same
 * function rather than reimplementing the list.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return REDACTION;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = keyIsSensitive(key) ? REDACTION : redact(inner, depth + 1);
    }
    return out;
  }
  // Primitives pass through: the KEY is what identifies PHI, and a bare
  // primitive reaching here has already been vetted by its key.
  return value;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  readonly [key: string]: unknown;
}

/**
 * One emitted log line, as a sink receives it.
 *
 * `context` has ALREADY been through `redact()`. That is the point of
 * routing sinks through here rather than letting each one collect its
 * own breadcrumbs: there is exactly one redaction, and a sink cannot
 * accidentally read the unredacted object because it is never handed one.
 */
export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly context: unknown;
}

/** A consumer of emitted log lines — today, the crash reporter (W-04). */
export type LogSink = (record: LogRecord) => void;

const sinks = new Set<LogSink>();

/**
 * Registers a sink. Returns its own removal, so a caller never has to
 * hold the same function reference to undo the registration.
 *
 * This is the seam `monitoring.ts` uses to turn log lines into crash
 * breadcrumbs. A crash reporter wired to `console` instead would see the
 * unredacted arguments, which is the one bypass this file exists to
 * prevent.
 */
export function addLogSink(sink: LogSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/** Test seam. Nothing in the app removes every sink at once. */
export function clearLogSinks(): void {
  sinks.clear();
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  // A debug line is not emitted at all outside development, so it does
  // not reach a sink either — a breadcrumb trail that exists only in
  // development is worse than none, because it reads as complete.
  if (level === 'debug' && !__DEV__) return;

  const payload = context === undefined ? undefined : redact(context);
  const line = `[medora] ${message}`;
  switch (level) {
    case 'debug':
      console.log(line, payload ?? '');
      break;
    case 'info':
      console.info(line, payload ?? '');
      break;
    case 'warn':
      console.warn(line, payload ?? '');
      break;
    case 'error':
      console.error(line, payload ?? '');
      break;
  }

  for (const sink of sinks) {
    try {
      sink({ level, message, context: payload });
    } catch {
      // A sink that throws must not take the caller down with it. The
      // caller is often an error path already, and a crash reporter that
      // crashes the app it reports on is worse than no reporter.
    }
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => write('debug', message, context),
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
};
