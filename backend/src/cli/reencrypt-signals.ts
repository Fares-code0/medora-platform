/**
 * SIGTERM / SIGINT for `npm run crypto:reencrypt` (review finding R5).
 *
 * The first signal **asks** the run to stop: the abort signal is checked
 * before every page and before every row's write, so the run finishes the
 * statement it is in, records `encryption_key.reencrypt_failed` with status
 * `interrupted` and its partial counts, releases the lock and exits 5.
 *
 * A second signal, or the grace period running out (a statement stuck on a
 * dead network), exits at once — `128 + signal number`, as a shell reports
 * it. That run then has only its `encryption_key.reencrypt_started` record,
 * which `--status` lists as having no outcome. SIGKILL and machine failure
 * cannot be handled at all; they end the same way.
 */

export type InterruptSignal = 'SIGTERM' | 'SIGINT';

export interface SignalSource {
  on(event: InterruptSignal, listener: () => void): unknown;
}

export const INTERRUPT_GRACE_MS = 60_000;
const SIGNAL_EXIT: Readonly<Record<InterruptSignal, number>> = { SIGINT: 130, SIGTERM: 143 };

export function installInterruptHandlers(
  source: SignalSource,
  controller: AbortController,
  out: (line: string) => void,
  exit: (code: number) => void,
  graceMs: number = INTERRUPT_GRACE_MS,
): void {
  let received = 0;

  const handle = (signal: InterruptSignal): void => {
    received++;
    if (received > 1) {
      out(`${signal} again: exiting now. This run keeps only its "started" audit record.`);
      exit(SIGNAL_EXIT[signal]);
      return;
    }

    out(
      `${signal} received: stopping before the next write and recording the outcome. Send it again to exit at once.`,
    );
    controller.abort(signal);
    setTimeout(() => {
      out(
        `The run did not stop within ${String(graceMs / 1000)} s; exiting. This run keeps only its "started" audit record.`,
      );
      exit(SIGNAL_EXIT[signal]);
    }, graceMs).unref();
  };

  source.on('SIGTERM', () => {
    handle('SIGTERM');
  });
  source.on('SIGINT', () => {
    handle('SIGINT');
  });
}
