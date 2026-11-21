import type { SafetyCheckRunner } from './safety-check';

/**
 * Fault injection for the safety screen.
 *
 * The fail-closed path is the most important behaviour in this feature and
 * the hardest to see, because on the demo formulary the check always
 * succeeds. `/doctor/pharmacy/new?simulate=error` (or `timeout`, or `slow`)
 * wraps the real runner so the blocking screen can be watched failing in the
 * live app, not only in a test.
 *
 * It wraps the *runner*, which is the same seam `runSafetyCheck` consumes, so
 * what a reviewer sees is the real fail-closed path rather than a
 * demonstration of a second one. The page only honours the parameter when
 * mocks are on, so it cannot exist on a build wired to a real service.
 */

export type SafetySimulation = 'error' | 'timeout' | 'slow' | 'unreadable';

export const SAFETY_SIMULATION_LABEL: Record<SafetySimulation, string> = {
  error: 'Simulated failure: the interaction check rejects.',
  timeout: 'Simulated failure: the interaction check never answers.',
  slow: 'Simulated latency: the interaction check answers slowly.',
  unreadable: 'Simulated failure: the interaction check answers with a result that cannot be read.',
};

const SIMULATIONS: readonly SafetySimulation[] = ['error', 'timeout', 'slow', 'unreadable'];

export function parseSafetySimulation(raw: string | null): SafetySimulation | null {
  return SIMULATIONS.find((value) => value === raw) ?? null;
}

const SLOW_MS = 3_000;

export function simulateSafetyRunner(
  simulation: SafetySimulation,
  base: SafetyCheckRunner,
): SafetyCheckRunner {
  return async (subject, signal) => {
    switch (simulation) {
      case 'error':
        throw new Error('Interaction service unavailable (simulated).');
      case 'timeout':
        // Resolves only on abort, which `runSafetyCheck`'s timer triggers.
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      case 'unreadable':
        return { ok: true };
      case 'slow':
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
        return base(subject, signal);
    }
  };
}
