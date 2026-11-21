import fs from 'node:fs';
import path from 'node:path';

/**
 * The bundle-size budget — checklist W-08, `docs/PERF.md` §1.
 *
 * ── Why this skips when there is no build, and when it must not ──────
 *
 * It reads the Hermes bytecode `expo export` produces. The main suite
 * runs BEFORE that build (Typecheck → Lint → Test → Build), so during
 * that pass there is nothing to read. Failing there would make a green
 * pipeline impossible for a reason unrelated to the code; skipping
 * loudly says so in the output. `parity.test.ts` takes the same approach
 * when the backend tree is absent.
 *
 * **A skip is only honest when nobody was promised a measurement.** CI
 * now runs this file again after Build, as its own step, and there a
 * missing bundle is not "nothing to measure yet" — it is a build that
 * did not produce what it was supposed to, and a guard that answered
 * "skipped" to that would be a green tick over an unmeasured budget.
 *
 * `PATIENT_APP_BUNDLE_REQUIRED=1` is how that step says so. Set, the
 * absence of a bundle FAILS instead of skipping. Unset — every local
 * run, and the main CI pass — behaviour is exactly as before.
 */

const ANDROID_BUNDLE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'dist',
  '_expo',
  'static',
  'js',
  'android',
);

/**
 * 3.20 MB, against a measured 2.90 MB. Loose enough that ordinary
 * feature work never trips it — eleven merged features moved the bundle
 * by about 60 KB — and tight enough that one substantial library cannot
 * arrive unnoticed. A ceiling, not a target; see `docs/PERF.md` §1
 * before raising it.
 */
const BUDGET_BYTES = 3_200_000;

function bundlePath(): string | null {
  if (!fs.existsSync(ANDROID_BUNDLE_DIR)) return null;
  const bundle = fs.readdirSync(ANDROID_BUNDLE_DIR).find((name) => name.endsWith('.hbc'));
  return bundle === undefined ? null : path.join(ANDROID_BUNDLE_DIR, bundle);
}

const found = bundlePath();

/**
 * Set by the CI step that runs after `expo export`. See the header: it
 * turns "there is no build yet" from a skip into a failure, because in
 * that step there is supposed to be one.
 */
const bundleRequired = process.env.PATIENT_APP_BUNDLE_REQUIRED === '1';
const describeIfBuilt = found === null ? describe.skip : describe;

describe('the bundle budget', () => {
  it('names where the build should be, so a skip is legible', () => {
    // Always runs. Without this the whole file disappears from the
    // output when there is no build, and a silent guard is not a guard.
    expect(ANDROID_BUNDLE_DIR).toContain(path.join('dist', '_expo'));
  });

  it('has a bundle to measure whenever one was promised', () => {
    // Unconditionally true when nothing promised a build, so this is a
    // no-op in every ordinary run. Under the CI step it is the assertion
    // that stops a skipped budget from reading as a passing one.
    expect(bundleRequired && found === null).toBe(false);
  });
});

describeIfBuilt('the Android bundle, when one has been built', () => {
  it(`is within the ${(BUDGET_BYTES / 1_000_000).toFixed(2)} MB budget`, () => {
    const size = fs.statSync(found as string).size;

    // If this fails, something was added. That may be correct — but it
    // is a decision, and `docs/PERF.md` §1 is where the reason goes.
    expect(size).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it('has not silently collapsed either', () => {
    // A bundle that suddenly shrank by half is a build that dropped
    // something, not a win. The floor is deliberately far below the
    // current size — it catches a broken export, not a real reduction.
    const size = fs.statSync(found as string).size;

    expect(size).toBeGreaterThan(1_000_000);
  });

  it('ships exactly one Android bundle', () => {
    // Two would mean the export produced a split this app does not
    // configure, and the budget above would then be measuring one of
    // them rather than what ships.
    const bundles = fs.readdirSync(ANDROID_BUNDLE_DIR).filter((name) => name.endsWith('.hbc'));

    expect(bundles).toHaveLength(1);
  });
});
