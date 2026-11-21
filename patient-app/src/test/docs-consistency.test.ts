import fs from 'node:fs';
import path from 'node:path';

/**
 * The documentation sweep, made mechanical — checklist W-12.
 *
 * The row's acceptance criterion is one sentence: **"No document
 * contradicts the code."** A sweep satisfies that on the day it is run
 * and starts decaying the next morning, so this suite exists to hold the
 * classes of claim that can be checked without a human reading anything.
 *
 * ── What went wrong before, and is now checked ───────────────────────
 *
 * The 2026-09-07 sweep found four contradictions, and every one of them
 * was the same shape: **a fact written down in two places, one of which
 * moved.**
 *
 * 1. `README.md` and `docs/ARCHITECTURE.md` both used `doctorService` as
 *    the worked example of `unavailableService`. BE-04 landed months of
 *    commits earlier; `features/doctors/service.ts` had passed a real
 *    adapter since. Both documents taught a new contributor that doctor
 *    discovery was unbuilt.
 * 2. `docs/ARCHITECTURE.md` §4 said "the only endpoint modules are
 *    `auth.ts` … and `account.ts` … and no source file mentions
 *    `me/appointments`". There were six modules, and `appointments.ts`
 *    was one of them.
 * 3. `README.md` said registration "refuses rather than sending
 *    `role: 'patient'`", and called ADR-030 *proposed*. ADR-030 was
 *    accepted on 2026-09-02 and `api/endpoints/auth.ts` sends exactly
 *    that role — which `parity.test.ts` asserts.
 * 4. `docs/TRACEABILITY.md` contradicted *itself*: the same
 *    `appointmentService.list('upcoming')` was 🟡 fixture-backed in the
 *    Home section and ✅ live two sections later.
 *
 * The fix for a fact in two places is not vigilance, it is one place.
 * `docs/ARCHITECTURE.md` §4.1 is now the only written record of which
 * side of the seam each feature is on, and §4.2 the only list of endpoint
 * modules. This suite fails when either drifts from the source.
 */

const APP = path.resolve(__dirname, '..', '..');
const SRC = path.join(APP, 'src');
const DOCS = path.join(APP, 'docs');

const readme = fs.readFileSync(path.join(APP, 'README.md'), 'utf8');
const architecture = fs.readFileSync(path.join(DOCS, 'ARCHITECTURE.md'), 'utf8');
const traceability = fs.readFileSync(path.join(DOCS, 'TRACEABILITY.md'), 'utf8');

/** Every Markdown document that describes the tree as it is *today*. */
const LIVING_DOCS = ['README.md', ...fs.readdirSync(DOCS).map((f) => path.join('docs', f))].filter(
  (f) => f.endsWith('.md'),
);

// ── The seam ─────────────────────────────────────────────────────────

/** What `features/<x>/service.ts` actually passes as its `http` adapter. */
interface SeamEntry {
  readonly feature: string;
  readonly adapter: string;
  /** The dependency `unavailableService` names, or `null` when live. */
  readonly dependency: string | null;
}

function readSeamFromSource(): SeamEntry[] {
  const featuresDir = path.join(SRC, 'features');
  return fs
    .readdirSync(featuresDir)
    .filter((feature) => fs.existsSync(path.join(featuresDir, feature, 'service.ts')))
    .sort()
    .map((feature) => {
      const source = fs.readFileSync(path.join(featuresDir, feature, 'service.ts'), 'utf8');
      const selection = /selectService\(\{([\s\S]*?)\n\}\)/.exec(source)?.[1] ?? '';
      const http = /http:\s*([A-Za-z_$][\w$]*)/.exec(selection)?.[1];
      if (http === undefined) throw new Error(`No http adapter found in ${feature}/service.ts`);
      const dependency =
        http === 'unavailableService'
          ? (/unavailableService<[^>]+>\(\s*'([^']+)'/.exec(selection)?.[1] ?? null)
          : null;
      return { feature, adapter: http, dependency };
    });
}

/** The table `docs/ARCHITECTURE.md` §4.1 publishes. */
function readSeamFromDocs(): SeamEntry[] {
  const block = /<!-- seam-table:start -->([\s\S]*?)<!-- seam-table:end -->/.exec(
    architecture,
  )?.[1];
  if (block === undefined) throw new Error('ARCHITECTURE.md §4.1 has no seam-table markers.');
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.includes('`'))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const [feature, adapter, dependency] = cells;
      const name = (adapter ?? '').replace(/`/g, '');
      return {
        feature: (feature ?? '').replace(/`/g, ''),
        adapter: name,
        // Only `unavailableService` states its dependency in a form the
        // source can be read for. `emergency` passes a local
        // `unconfigured` object whose blocker (BE-11) lives in prose, so
        // the table is left free to name it and this check does not
        // pretend to verify it.
        dependency:
          name !== 'unavailableService' || dependency === '—' || dependency === undefined
            ? null
            : dependency,
      };
    });
}

describe('the seam table in ARCHITECTURE.md §4.1 (W-12)', () => {
  it('names every feature that has a service, and no others', () => {
    expect(readSeamFromDocs().map((e) => e.feature)).toEqual(
      readSeamFromSource().map((e) => e.feature),
    );
  });

  it('agrees with the source about which adapter each feature passes', () => {
    // The check that would have caught the doctors example: a feature
    // whose `service.ts` passes `httpDoctorService` cannot be documented
    // as `unavailableService`, in this table or anywhere downstream of it.
    expect(readSeamFromDocs()).toEqual(readSeamFromSource());
  });
});

describe('worked examples in the living documents (W-12)', () => {
  /**
   * `unavailableService<XService>(…)` inside a fenced example claims that
   * feature X is unbuilt. Both README.md and ARCHITECTURE.md once made
   * that claim about doctors, months after it stopped being true.
   */
  it('never show a live feature behind `unavailableService`', () => {
    const blocked = new Set(
      readSeamFromSource()
        .filter((e) => e.adapter === 'unavailableService')
        .map((e) => e.feature.toLowerCase()),
    );

    for (const relative of LIVING_DOCS) {
      const text = fs.readFileSync(path.join(APP, relative), 'utf8');
      for (const match of text.matchAll(/unavailableService<(\w+?)Service>/g)) {
        const feature = (match[1] ?? '').toLowerCase();
        // `T` from a generic signature, not a feature name.
        if (feature.length <= 1) continue;
        expect({ doc: relative, feature, blocked: blocked.has(feature) }).toEqual({
          doc: relative,
          feature,
          blocked: true,
        });
      }
    }
  });
});

// ── The endpoint layer ───────────────────────────────────────────────

describe('the endpoint-module table in ARCHITECTURE.md §4.2 (W-12, V-02)', () => {
  it('lists exactly the modules in `src/api/endpoints/`', () => {
    const onDisk = fs.readdirSync(path.join(SRC, 'api', 'endpoints')).sort();
    const section = architecture.slice(architecture.indexOf('### 4.2'));
    const documented = [...section.matchAll(/^\| `([\w-]+\.ts)` \|/gm)].map((m) => m[1]).sort();

    // `parity.test.ts` pins the directory listing against the controllers
    // that back it; this pins the prose against the same listing, which is
    // the half that drifted.
    expect(documented).toEqual(onDisk);
  });
});

// ── Links and scripts ────────────────────────────────────────────────

describe('cross-references (W-12)', () => {
  it('resolves every relative Markdown link', () => {
    const broken: string[] = [];
    for (const relative of LIVING_DOCS) {
      const from = path.join(APP, relative);
      const text = fs.readFileSync(from, 'utf8');
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = (match[1] ?? '').split('#')[0];
        if (target === undefined || target === '' || /^[a-z]+:/i.test(target)) continue;
        if (!fs.existsSync(path.resolve(path.dirname(from), target))) {
          broken.push(`${relative} → ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('names only scripts that `package.json` defines', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const referenced = new Set(
      [...readme.matchAll(/npm (?:--prefix patient-app )?run ([\w:]+)/g)].map((m) => m[1] ?? ''),
    );
    for (const script of referenced) {
      expect({ script, defined: script in pkg.scripts }).toEqual({ script, defined: true });
    }
    // A guard against the assertion above passing vacuously.
    expect(referenced.size).toBeGreaterThan(3);
  });
});

// ── The checklist ────────────────────────────────────────────────────
//
// The check that lived here — "never marks a row ✅ while naming a file
// that does not exist" — moved to `checklist-consistency.test.ts` on
// 2026-09-13, widened and fixed on the way. It asked only about ✅ rows,
// and every one of the fourteen rows that were naming files nobody had
// written was 🟨. It also split its cells on a bare `|`, which reads the
// wrong column for the two rows whose text contains an escaped one
// (D-05's `booting \| authenticated`, K-01's context vocabulary).
//
// One place per fact: the checklist's own consistency file is where a
// claim about the checklist belongs.

/**
 * **Every screen is in the traceability register** — A-04.
 *
 * The row's acceptance says it in as many words: *"Every screen in
 * Phases F–P appears with a row; no row names an endpoint that is not in
 * the API contract or in §15.3."* The second half is a rule a reviewer
 * applies to a row being written. The first half is a claim about a
 * whole directory, and it decays the moment somebody adds a screen —
 * which is exactly what happened: `OnboardingScreen`, `ConsentScreen`
 * and `SupportScreen` had never had a row.
 *
 * Their absence was not a gap in the *work* — all three read
 * configuration rather than an API — and that is the reason to insist on
 * it rather than to shrug. "Absent from the register" and "needs an
 * endpoint nobody has built" are the two states this document exists to
 * keep apart, and a screen that needs nothing from the backend has to
 * say so to be distinguishable from one that was forgotten.
 */
describe('the traceability register covers every screen (A-04)', () => {
  function screenComponents(): string[] {
    const featuresDir = path.join(SRC, 'features');
    const names: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          path.basename(dir) === 'screens' &&
          entry.name.endsWith('.tsx') &&
          !entry.name.includes('.test.')
        ) {
          names.push(entry.name.replace(/\.tsx$/, ''));
        }
      }
    };
    walk(featuresDir);
    return names.sort();
  }

  const screens = screenComponents();

  it('finds the screens at all, so an empty scan cannot pass', () => {
    expect(screens.length).toBeGreaterThan(20);
  });

  it('names every one of them', () => {
    expect(screens.filter((name) => !traceability.includes(name))).toEqual([]);
  });
});
