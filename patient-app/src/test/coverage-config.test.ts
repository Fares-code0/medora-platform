import fs from 'node:fs';
import path from 'node:path';

/**
 * Coverage reporting stays reporting — checklist U-10.
 *
 * The row's acceptance is two clauses and the second one is the
 * interesting one: *"Reported; **the threshold is the owner's call**."*
 *
 * A coverage number that only CI prints is easy to turn into a gate, and
 * a gate is a decision — one that fails an honest pull request the first
 * time someone deletes a well-covered file, or removes a dead branch and
 * takes the ratio down with it. These tests hold the row's shape: the
 * reporting exists, and nobody has quietly attached a number to it.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(ROOT, '..');

interface JestConfig {
  readonly collectCoverageFrom?: readonly string[];
  readonly coverageReporters?: readonly string[];
  readonly coverageThreshold?: unknown;
  readonly testTimeout?: number;
}

/* eslint-disable @typescript-eslint/no-require-imports -- the config is
   CommonJS and reading it as data is the point. */
const jestConfig = require(path.join(ROOT, 'jest.config.js')) as JestConfig;
/* eslint-enable @typescript-eslint/no-require-imports */

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('the report exists and can be produced', () => {
  it('has a script that produces it', () => {
    expect(packageJson.scripts['test:coverage']).toBe('jest --coverage');
  });

  it('prints a summary, so the number lands in the CI log', () => {
    // A reviewer is already reading the job log. A report that only
    // exists as an lcov file on a deleted runner is not reported.
    expect(jestConfig.coverageReporters).toContain('text-summary');
  });

  it('measures the whole of src, minus the tests measuring it', () => {
    expect(jestConfig.collectCoverageFrom).toEqual(
      expect.arrayContaining(['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/test/**']),
    );
  });
});

/**
 * Every `waitFor` ceiling in the suite is reachable — checklist U-06.
 *
 * ── The flake this closes ───────────────────────────────────────────
 *
 * Four suites wait up to 10 s for a screen's queries to settle, each
 * with a paragraph explaining that the ceiling is on pathology rather
 * than a pause. None of them could reach it: Jest's per-test timeout
 * defaults to 5 s, so the test died at five while its `waitFor` counted
 * to ten, and the failure read "exceeded timeout of 5000 ms" — a message
 * about the harness, not about what was being waited for.
 *
 * On an idle machine it passed, which is what made it a flake instead of
 * a bug. CI runs `test:coverage`; instrumentation roughly doubles render
 * time, and four concurrent React Query screens on a contended runner is
 * exactly the case the 10 s was chosen for.
 *
 * So this asserts the relationship rather than the number: whatever
 * ceiling a test asks for, the harness must let it get there. A new
 * 30 s wait added without raising `testTimeout` fails here, next to the
 * config it needs to change, rather than intermittently in CI a week
 * later.
 */
describe('the harness lets every wait finish (U-06)', () => {
  const CEILING = /timeout:\s*([\d_]+)/g;

  function waitCeilings(): { file: string; ms: number }[] {
    const found: { file: string; ms: number }[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.test\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          for (const match of source.matchAll(CEILING)) {
            const ms = Number((match[1] ?? '').replace(/_/g, ''));
            // `{ kind: 'timeout' }` and friends are not durations.
            if (Number.isFinite(ms) && ms > 0) found.push({ file: entry.name, ms });
          }
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    return found;
  }

  it('gives every test at least as long as its longest wait asks for', () => {
    const ceilings = waitCeilings();
    const configured = jestConfig.testTimeout ?? 5_000;

    // A guard against the scan finding nothing and passing vacuously.
    expect(ceilings.length).toBeGreaterThan(0);

    for (const ceiling of ceilings) {
      expect({ ...ceiling, reachable: ceiling.ms <= configured }).toEqual({
        ...ceiling,
        reachable: true,
      });
    }
  });

  it('sets the timeout explicitly rather than inheriting five seconds', () => {
    expect(jestConfig.testTimeout).toBeGreaterThan(5_000);
  });
});

describe('nobody has turned the report into a gate', () => {
  it('sets no coverage threshold', () => {
    // If this fails because a threshold was added ON PURPOSE, that is a
    // decision the owner makes — record it in docs/COVERAGE.md and in
    // the checklist row, then change this assertion deliberately.
    expect(jestConfig.coverageThreshold).toBeUndefined();
  });

  it('does not fail the CI job on a coverage drop', () => {
    const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');

    // The patient-app job runs the suite once, with coverage. A second
    // pass would double a nine-second job to print one summary.
    expect(workflow).toContain('npm run test:coverage');
  });
});

describe('the document itself', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'COVERAGE.md'), 'utf8');

  it('is the U-10 deliverable', () => {
    expect(doc).toContain('U-10');
  });

  it('says the threshold is unset, and whose call it is', () => {
    expect(doc).toContain('no threshold');
    expect(doc).toContain('owner');
  });

  it('records what is least covered rather than only the headline', () => {
    // A single percentage is the least useful thing a coverage report
    // produces. The areas are what a reader can act on.
    expect(doc).toContain('features/messages');
    expect(doc).toContain('features/health');
  });
});
