import { env } from '@/configs/env';
import { addLogSink, logger, redact, type LogRecord } from '@/utils/logger';

// Read straight from the manifest rather than through
// `features/app-version/version.ts`, which holds the same constant: this
// is a platform module and the layering rule forbids it importing a
// feature (ARCHITECTURE.md §3). It is not a second source of truth —
// `app.json` is the source, and both modules read it.
import appConfig from '../../app.json';

/**
 * Crash reporting (checklist W-04).
 *
 * ── What this file is, and what it is not ────────────────────────────
 * It is the **redaction pipeline and the port**. It is not a vendor
 * integration: no crash service is chosen, no DSN exists, and choosing
 * one is an owner decision with a contractual half — a crash reporter for
 * a health app is a processor of patient data, and picking it is a
 * procurement question, not an import.
 *
 * What is built here is the half that must exist *before* that choice,
 * because it is the half that is dangerous to retrofit: by the time a
 * provider SDK is installed, the app is already handing it exceptions,
 * and every one of those exceptions was assembled somewhere else. A
 * provider added later plugs into `registerCrashSink` and receives
 * reports that have already been through `toReport` — it never sees an
 * `Error`, so it cannot read a field this module decided not to send.
 *
 * ── The rule, and the reason the message is missing ──────────────────
 * **`error.message` is never reported.** Not redacted by key, not
 * pattern-matched, not truncated — absent.
 *
 * `logger.ts` redacts by *field name*, which works because a log context
 * is an object whose keys the developer wrote. An exception message is a
 * bare string, and inside a records screen it is routinely built from the
 * data that made it throw: `Unknown severity for allergen Penicillin`,
 * `Cannot read property 'value' of undefined` interpolated with a result,
 * a Zod issue naming the value it rejected. There is no key to match on,
 * so there is no safe way to keep it. A crash report carrying a patient's
 * allergen is a disclosure to whoever operates the crash service (T-04),
 * and the report is worth less than the disclosure costs.
 *
 * What replaces it is enough to find the defect without it:
 *
 * - `name` — the constructor name. Developer-authored, or the engine's.
 * - `frames` — the stack with its header removed (see `stackFrames`).
 *   File, function and line are developer-authored.
 * - `componentStack` — for a render crash, the React component path.
 * - `breadcrumbs` — the last log lines, already redacted by `logger.ts`.
 * - `context` — a caller-supplied object, run through `redact()`.
 *
 * ── What is deliberately not here ────────────────────────────────────
 * Unhandled *promise* rejections. React Native tracks them through
 * `promise/setimmediate/rejection-tracking`, which is initialised inside
 * the runtime's own setup and is not a stable seam to hook. The ones that
 * matter in this app are already caught: every request goes through
 * `ApiClient`, and every query through TanStack Query's error path.
 */

/** Ring-buffer size for breadcrumbs. Enough for one screen's worth. */
const MAX_BREADCRUMBS = 20;
/** Stack frames kept. Past this the trace is library internals. */
const MAX_FRAMES = 24;
/** A frame longer than this is a bundled path, not information. */
const MAX_FRAME_LENGTH = 240;

export type CrashKind =
  /** A React render threw and `ErrorBoundary` caught it. */
  | 'render'
  /** The JS engine's last-resort handler ran. Usually fatal. */
  | 'unhandled'
  /** The app caught it, handled it, and wants it reported anyway. */
  | 'handled';

export interface Breadcrumb {
  readonly level: LogRecord['level'];
  /** Developer-authored: `logger` takes a fixed message, never free text. */
  readonly message: string;
  /** Already redacted by `logger.ts`. */
  readonly context: unknown;
}

export interface CrashReport {
  readonly kind: CrashKind;
  /** The error's constructor name, e.g. `TypeError`. Never its message. */
  readonly name: string;
  readonly fatal: boolean;
  readonly frames: readonly string[];
  /** React's component path, for a `render` crash. */
  readonly componentStack: string | null;
  readonly breadcrumbs: readonly Breadcrumb[];
  /** Caller-supplied, redacted by key exactly as a log context is. */
  readonly context: unknown;
  readonly appVersion: string;
  readonly appEnv: string;
}

/**
 * Where a report goes. A provider adapter implements this and nothing
 * else — see the file header for why it receives a `CrashReport` rather
 * than an `Error`.
 */
export type CrashSink = (report: CrashReport) => void;

const sinks = new Set<CrashSink>();
let breadcrumbs: Breadcrumb[] = [];
let detachLogSink: (() => void) | null = null;

/**
 * Guards against a cycle: a sink that logs would produce a breadcrumb,
 * which is harmless, but a sink that logs an *error* while the app is
 * already reporting one turns one crash into an unbounded trail. While a
 * report is being delivered, log lines are not collected.
 */
let delivering = false;

/** Registers a sink. Returns its own removal. */
export function registerCrashSink(sink: CrashSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/** Test seam, and the uninstall half of `installCrashReporting`. */
export function resetMonitoring(): void {
  sinks.clear();
  breadcrumbs = [];
  detachLogSink?.();
  detachLogSink = null;
}

/**
 * The frames of a stack, with the message line removed.
 *
 * Both engines this app runs on print `${name}: ${message}` and then the
 * frames, so the header is removed **by length** rather than by matching
 * a newline: a message containing its own line breaks would otherwise
 * leave its tail behind, and the tail is the half most likely to be the
 * interpolated value.
 *
 * What survives the header removal is then filtered to lines that are
 * *shaped* like a frame — Hermes and V8 write `at fn (file:line:col)`,
 * JavaScriptCore writes `fn@file:line:col`. An address or an email in a
 * leftover message line matches neither, because both forms require a
 * trailing `:line:col`.
 */
export function stackFrames(error: Error): readonly string[] {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  if (stack === '') return [];

  const header = `${error.name}: ${error.message}`;
  const body = stack.startsWith(header) ? stack.slice(header.length) : stack;

  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^at .*:\d+:\d+\)?$/.test(line) || /^\S+@\S+:\d+:\d+$/.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => (line.length > MAX_FRAME_LENGTH ? `${line.slice(0, MAX_FRAME_LENGTH)}…` : line));
}

/**
 * Builds the report. Exported so the test that proves the guarantee can
 * assert on the payload without a sink, and so a provider adapter has
 * nothing left to assemble.
 */
export function toReport(
  error: unknown,
  options: {
    readonly kind: CrashKind;
    readonly fatal?: boolean;
    readonly componentStack?: string | null;
    readonly context?: Record<string, unknown>;
  },
): CrashReport {
  // A thrown non-Error (a string, an object, `undefined`) is common in
  // JS and carries nothing safe: its own text IS the message. Only the
  // fact that something non-Error was thrown is reported.
  const isError = error instanceof Error;

  return {
    kind: options.kind,
    name: isError ? error.name : 'NonError',
    fatal: options.fatal ?? options.kind === 'unhandled',
    frames: isError ? stackFrames(error) : [],
    componentStack: options.componentStack ?? null,
    breadcrumbs: [...breadcrumbs],
    context: options.context === undefined ? undefined : redact(options.context),
    appVersion: appConfig.expo.version,
    appEnv: env.appEnv,
  };
}

/**
 * Reports a crash to every registered sink.
 *
 * With no sink registered this is a no-op, which is the state of a
 * production build today and is deliberate: an unconfigured reporter
 * drops reports, it does not invent a destination for them. The same rule
 * N-04 applies to an unconfigured emergency number.
 */
export function reportCrash(
  error: unknown,
  options: {
    readonly kind: CrashKind;
    readonly fatal?: boolean;
    readonly componentStack?: string | null;
    readonly context?: Record<string, unknown>;
  },
): CrashReport {
  const report = toReport(error, options);
  delivering = true;
  try {
    for (const sink of sinks) {
      try {
        sink(report);
      } catch {
        // A reporter that crashes the app it reports on is worse than no
        // reporter. Swallowed on purpose, and not logged — logging here
        // is the recursion the `delivering` flag already guards.
      }
    }
  } finally {
    delivering = false;
  }
  return report;
}

/**
 * The development sink: prints the report through the redacting logger.
 *
 * It goes through `logger` rather than `console` for the reason every
 * other line in this tree does — `no-console` is an ESLint error and the
 * one exception is `logger.ts`. The report is already redacted, so this
 * is a second pass over safe data rather than the pass that makes it
 * safe.
 */
export const consoleCrashSink: CrashSink = (report) => {
  logger.error('Crash report', {
    crashKind: report.kind,
    errorName: report.name,
    fatal: report.fatal,
    frames: report.frames,
    breadcrumbCount: report.breadcrumbs.length,
  });
};

/**
 * Wires the reporter into the app: log lines become breadcrumbs, and the
 * engine's last-resort handler becomes a report.
 *
 * Called once from `bootstrap/App.tsx`. Returns its own uninstall, which
 * only the tests use — the app installs this for its lifetime.
 */
export function installCrashReporting(
  options: { readonly sinks?: readonly CrashSink[] } = {},
): () => void {
  resetMonitoring();

  const chosen = options.sinks ?? (env.isDev ? [consoleCrashSink] : []);
  for (const sink of chosen) registerCrashSink(sink);

  detachLogSink = addLogSink((record) => {
    if (delivering) return;
    breadcrumbs.push({
      level: record.level,
      message: record.message,
      context: record.context,
    });
    if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
  });

  const restoreGlobalHandler = installGlobalHandler();

  return () => {
    restoreGlobalHandler();
    resetMonitoring();
  };
}

/**
 * React Native's engine-level handler, hooked without replacing it.
 *
 * The previous handler is what shows the red box in development and what
 * terminates the app on a fatal in production. Taking it over rather than
 * chaining to it would mean a crash the reporter saw is a crash the
 * developer never does.
 *
 * `ErrorUtils` is a React Native global with no ambient type in this
 * project, and it is absent under a plain Node test runner, so the
 * presence check is real rather than defensive dressing.
 */
function installGlobalHandler(): () => void {
  const holder = globalThis as {
    ErrorUtils?: {
      getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const errorUtils = holder.ErrorUtils;
  if (errorUtils?.setGlobalHandler === undefined || errorUtils.getGlobalHandler === undefined) {
    return () => {};
  }

  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    reportCrash(error, { kind: 'unhandled', fatal: isFatal ?? true });
    previous?.(error, isFatal);
  });

  return () => {
    if (previous !== undefined) errorUtils.setGlobalHandler?.(previous);
  };
}
