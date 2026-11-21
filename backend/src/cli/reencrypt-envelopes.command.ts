import {
  type EnvelopeReencryptionService,
  type PartialCounts,
  ReencryptionAuditUnavailableError,
  ReencryptionFailedError,
  ReencryptionLockedError,
  ReencryptionLockLostError,
  ReencryptionPoolerDetectedError,
  type ReencryptionReport,
  type StatusReport,
} from '../shared/crypto';

import type { CommandOutput } from './bootstrap-admin.command';
import { parseReencryptArgs, REENCRYPT_USAGE } from './reencrypt-envelopes.args';

/**
 * The body of `npm run crypto:reencrypt`, without the process around it —
 * the same split as `bootstrap-admin.command.ts`, for the same reason: the
 * e2e drives the argument handling, output and exit codes against an
 * application it booted itself.
 *
 * Exit codes:
 *
 * - **0** a complete verification pass found every envelope conforming, no
 *   stale writer was seen, and (real runs) both audit rows were written.
 *   **Point-in-time** (R1): it cannot see a write made after the pass, and
 *   it is a precondition for retiring a key, never permission by itself.
 * - **1** values remain, a stale writer was seen, or the run failed
 *   part-way (safe to rerun).
 * - **2** usage; nothing was done.
 * - **3** another re-encryption holds the lock; nothing was done.
 * - **4** the audit ledger could not record the run.
 * - **5** stopped by SIGTERM / SIGINT (R5); the outcome is recorded when
 *   the ledger allowed it.
 * - **6** the connection is pooled in a way a session lock cannot survive
 *   (R3); nothing was done.
 *
 * `--status`: 1 while some run started, recorded no outcome, and no complete
 * run has followed it; 0 otherwise.
 */
export const EXIT = {
  clean: 0,
  incomplete: 1,
  usage: 2,
  locked: 3,
  auditUnavailable: 4,
  interrupted: 5,
  pooled: 6,
} as const;

/**
 * Who must already be on the new configuration, drained of old instances,
 * before a verifying run starts (R1). One list, printed and documented.
 */
export const ENVELOPE_WRITERS =
  'API replicas, background workers and scheduled jobs, autoscaling and launch templates, old task definitions or deployments that could be started again, other regions, and any other process that writes envelopes';

export interface ReencryptApplication {
  readonly service: EnvelopeReencryptionService;
  close(): Promise<void>;
}

export interface CommandOptions {
  /** Aborted by the process's SIGTERM / SIGINT handler (`reencrypt-signals.ts`). */
  readonly signal?: AbortSignal;
}

export async function runReencryptCommand(
  argv: readonly string[],
  open: () => Promise<ReencryptApplication>,
  out: CommandOutput,
  options: CommandOptions = {},
): Promise<number> {
  const parsed = parseReencryptArgs(argv);

  if (parsed.kind === 'usage') {
    if (parsed.problem !== null) out.error(`${parsed.problem}\n`);
    out.error(REENCRYPT_USAGE);
    return EXIT.usage;
  }

  const app = await open();

  try {
    if (options.signal?.aborted === true && parsed.kind === 'run') {
      out.error('Interrupted before the run started; nothing was done.');
      return EXIT.interrupted;
    }

    if (parsed.kind === 'status') {
      const status = await app.service.status();
      for (const line of describeStatus(status)) out.log(line);
      return status.unresolved.length === 0 ? EXIT.clean : EXIT.incomplete;
    }

    const report = await app.service.run({
      dryRun: parsed.args.dryRun,
      ...(parsed.args.batchSize === undefined ? {} : { batchSize: parsed.args.batchSize }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    for (const line of describe(report)) out.log(line);
    return exitCodeOf(report);
  } catch (error) {
    if (
      error instanceof ReencryptionLockedError ||
      error instanceof ReencryptionPoolerDetectedError
    ) {
      out.error(error.message);
      return error instanceof ReencryptionLockedError ? EXIT.locked : EXIT.pooled;
    }
    if (error instanceof ReencryptionAuditUnavailableError) {
      out.error(error.message);
      return EXIT.auditUnavailable;
    }
    if (error instanceof ReencryptionFailedError) {
      out.error(error.message);
      // The cause's own message only for this code's errors, whose text is
      // written here and carries no data; a database error's message can
      // quote row values, so it is named by class only.
      if (
        error.cause instanceof ReencryptionLockLostError ||
        error.cause instanceof ReencryptionPoolerDetectedError
      ) {
        out.error(`Cause: ${error.cause.message}`);
      }
      out.error(describePartial(error.partial));
      if (error.failureAudited !== null) {
        out.error(
          error.failureAudited
            ? `Recorded in the audit ledger as encryption_key.reencrypt_failed (${error.interrupted ? 'interrupted' : 'failed'}, run ${error.runId}).`
            : `The ${error.interrupted ? 'interruption' : 'failure'} could NOT be recorded in the audit ledger; only encryption_key.reencrypt_started marks run ${error.runId} (\`--status\` lists it).`,
        );
      }
      out.error(
        'Every value re-sealed so far stays readable with the current configuration. Rerun to continue. Do not remove a previous key.',
      );
      return error.interrupted ? EXIT.interrupted : EXIT.incomplete;
    }
    throw error;
  } finally {
    await app.close();
  }
}

function exitCodeOf(report: ReencryptionReport): number {
  if (!report.dryRun && report.audit.outcome !== true) return EXIT.auditUnavailable;
  return report.clean ? EXIT.clean : EXIT.incomplete;
}

/** Every counter, with the lower-bound caveat when a write was in flight (R6). */
export function describePartial(partial: PartialCounts): string {
  const counts = `${String(partial.scanned)} scanned · ${String(partial.alreadyCurrent)} already current · ${String(partial.resealed)} re-sealed · ${String(partial.concurrentCurrent)} rewritten concurrently (current) · ${String(partial.vanished)} removed concurrently · ${String(partial.staleWrites)} stale concurrent write(s) · ${String(partial.unreadable)} unreadable · ${String(partial.unresolved)} unresolved · ${String(partial.uncertainWrites)} write(s) with unknown outcome`;
  return partial.uncertainWrites > 0
    ? `Before it stopped (lower bounds — ${String(partial.uncertainWrites)} write(s) may have committed without being acknowledged): ${counts}.`
    : `Before it stopped: ${counts}.`;
}

/** The operator's report. Identifiers and counts only — never a key or a value. */
export function describe(report: ReencryptionReport): string[] {
  const lines = [
    `${report.dryRun ? 'Dry run — nothing was written.' : 'Re-encryption pass finished.'} Run ${report.runId}, started ${report.startedAt}. Current key ${report.currentKeyId}, writing the ${report.writeFormat} format; ${String(report.previousKeys)} other key(s) configured.`,
    '',
  ];

  for (const column of report.columns) {
    lines.push(
      `${column.table}.${column.column}: ${String(column.scanned)} scanned · ${String(column.alreadyCurrent)} already current · ${String(column.resealed)} ${report.dryRun ? 'to re-seal' : 're-sealed'} · ${String(column.concurrentCurrent)} rewritten concurrently (current) · ${String(column.vanished)} removed concurrently · ${String(column.staleWrites)} stale concurrent write(s) · ${String(column.unreadable)} unreadable · ${String(column.unresolved)} unresolved`,
    );
    if (column.unreadableIds.length > 0) {
      lines.push(`  unreadable rows: ${idList(column.unreadableIds, column.unreadable)}`);
    }
    if (column.unresolvedIds.length > 0) {
      lines.push(`  unresolved rows: ${idList(column.unresolvedIds, column.unresolved)}`);
    }
  }

  if (report.verification !== null) {
    lines.push('', 'Verification pass (read-only, after every write):');
    for (const column of report.verification) {
      lines.push(
        `${column.table}.${column.column}: ${String(column.scanned)} scanned · ${String(column.conforming)} conforming · ${String(column.nonConforming)} not conforming · ${String(column.unreadable)} unreadable`,
      );
      if (column.nonConformingIds.length > 0) {
        lines.push(`  not conforming: ${idList(column.nonConformingIds, column.nonConforming)}`);
      }
      if (column.unreadableIds.length > 0) {
        lines.push(`  unreadable rows: ${idList(column.unreadableIds, column.unreadable)}`);
      }
    }
  }

  lines.push('');

  if (!report.dryRun) {
    lines.push(
      report.audit.outcome === true
        ? `Recorded in the audit ledger as encryption_key.reencrypted (${report.clean ? 'complete' : 'incomplete'}).`
        : 'The outcome could NOT be recorded in the audit ledger (only encryption_key.reencrypt_started marks this run). The rewrites stand; treat the run as unverified and rerun once the ledger is reachable.',
    );
  }

  if (report.staleWrites > 0) {
    lines.push(
      `${String(report.staleWrites)} concurrent write(s) under a previous key or the other format were seen: an instance is still running an old configuration. Make every instance use the current DATA_ENCRYPTION_KEY and DATA_ENCRYPTION_WRITE_FORMAT, then rerun. Do not remove a previous key.`,
    );
  }

  const unreadable =
    report.verification === null
      ? report.columns.reduce((sum, column) => sum + column.unreadable, 0)
      : report.verification.reduce((sum, column) => sum + column.unreadable, 0);

  if (report.clean && report.dryRun) {
    // R4: a dry run never authorizes retiring anything.
    lines.push(
      'Every envelope conformed when this dry run read it. A dry run is not evidence for retiring a key and is not audited.',
      `Next: once every envelope-writing process (${ENVELOPE_WRITERS}) runs the current configuration and old instances are drained, run --confirm.`,
    );
  } else if (report.clean && report.audit.outcome === true) {
    lines.push(
      `Verification passed: every envelope conformed when the verification pass read it. This is a point-in-time result — it cannot see writes made after the pass, and it does not prevent future stale writes.`,
    );
    if (report.previousKeys > 0) {
      lines.push(
        `DATA_ENCRYPTION_KEY_PREVIOUS may be retired only if, before this run started (${report.startedAt}), every envelope-writing process (${ENVELOPE_WRITERS}) was already on this configuration and every old instance had drained. If that is not certain, make it so and run --confirm again. Keep the retired key offline (PRODUCTION_SETUP.md §2.1).`,
      );
    }
  } else if (unreadable > 0) {
    lines.push(
      `${String(unreadable)} value(s) open under no configured key and were left untouched. Do not remove a previous key until they are explained: one may still be needed to read them.`,
    );
  } else if (report.remaining > 0) {
    lines.push(
      report.dryRun
        ? `${String(report.remaining)} value(s) would be re-sealed. Once every envelope-writing process runs the current configuration, run --confirm.`
        : `${String(report.remaining)} value(s) are still not conforming. Rerun. Do not remove a previous key.`,
    );
  }

  return lines;
}

/** `--status`: recent runs, and any that never recorded an outcome (R5). */
export function describeStatus(status: StatusReport): string[] {
  const active = status.activeRun;
  const holderLine =
    active === null
      ? 'No re-encryption holds the advisory lock right now.'
      : active.runId === null
        ? 'An unidentified session holds the re-encryption lock right now; no run without an outcome is assumed to be it.'
        : `A ${active.mode === 'dry-run' ? 'dry run' : 'confirm run'} (run ${active.runId}) holds the advisory lock right now${
            active.mode === 'confirm' && !active.hasStartedRecord
              ? '; its started record is not written yet'
              : ''
          }.`;
  const lines = [holderLine, ''];
  if (status.runs.length === 0) {
    lines.push('No re-encryption run is recorded in the audit ledger.');
  }
  for (const run of status.runs) {
    const outcome =
      run.outcome === null
        ? status.unmatched.some((open) => open.runId === run.runId)
          ? `NO OUTCOME — ended without one (SIGKILL, power loss or machine failure)${
              status.unresolved.some((open) => open.runId === run.runId)
                ? ''
                : '; superseded by a later complete run'
            }`
          : 'no outcome yet — running now (it holds the lock)'
        : `${run.outcome} at ${run.outcomeAt ?? '?'}`;
    lines.push(`${run.startedAt}  run ${run.runId}  ${outcome}`);
  }
  if (status.unresolved.length > 0) {
    lines.push(
      '',
      `${String(status.unresolved.length)} run(s) started but never recorded an outcome, with no complete run since. Their rewrites stand and stay readable; run --confirm to finish, and do not retire a key on the strength of them.`,
    );
  } else if (status.unmatched.length > 0) {
    lines.push(
      '',
      `${String(status.unmatched.length)} earlier run(s) never recorded an outcome; a later complete run has re-verified every value since.`,
    );
  }
  return lines;
}

function idList(ids: readonly string[], total: number): string {
  const more = total - ids.length;
  return `${ids.join(', ')}${more > 0 ? ` (and ${String(more)} more)` : ''}`;
}
