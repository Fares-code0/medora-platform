import { MOCK_LAB_TESTS } from './corpus';
import type { LabTest } from './types';

/**
 * The session-lifetime lab store (D-05).
 *
 * **Why the store moved here and not only the seed.** D-11 made review state
 * mutable, and it lived in a `Map` private to the labs mock adapter. Had the
 * patient profile projected the *seed* instead, a result the doctor marked
 * reviewed on the Labs screen would still read "unreviewed" on that patient's
 * profile — two screens disagreeing about the same order, which is the exact
 * defect D-05 exists to end. One store means they cannot.
 *
 * Nothing here is transmitted anywhere and nothing is persisted: the Map dies
 * with the tab. `services/preferences.ts` is the app's only sanctioned storage
 * boundary and it is for UI preferences, never PHI.
 *
 * The labs adapter still owns every *rule* about writing — `assessReviewability`,
 * the private-symbol `ReviewableTest`, the re-check against a concurrent
 * review. This module owns only the box those rules write into.
 */

const tests = new Map<string, LabTest>(MOCK_LAB_TESTS.map((test) => [test.id, test]));

export function listLabTests(): readonly LabTest[] {
  return Array.from(tests.values());
}

export function getLabTest(labId: string): LabTest | undefined {
  return tests.get(labId);
}

/** Replaces one order wholesale. Callers own the rules that produced it. */
export function putLabTest(next: LabTest): void {
  tests.set(next.id, next);
}

/** Test-only reset so suites do not leak reviews into each other. */
export function __resetLabStudies(): void {
  tests.clear();
  for (const test of MOCK_LAB_TESTS) tests.set(test.id, test);
}
