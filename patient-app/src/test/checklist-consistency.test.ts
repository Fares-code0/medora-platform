import fs from 'node:fs';
import path from 'node:path';

/**
 * The checklist's summaries are recounted, not incremented — W-12.
 *
 * ── The defect this exists for, which has now happened three times ──
 *
 * `PATIENT_FRONTEND_CHECKLIST.md` writes a row's status in exactly one
 * place and summarises it in three: a by-status table, a by-phase table,
 * and the prose headings that open each "what the N rows are" section.
 * So every close of a row is one edit and three chances to forget one,
 * and the document says as much in its own words:
 *
 *   > Recounted from the rows, not incremented — twice now. […] A row's
 *   > status is written in one place and summarised in two, so drift is
 *   > the default and the only durable fix is to recount.
 *
 * It was right about the default and generous about the fix. Recounting
 * *by hand* is not durable — it is the same manual step that drifted,
 * done again — and the third drift was sitting in the document when this
 * test was written: the by-status table read 42 🟨 and the section
 * below it was still headed "What the 33 🟨 rows are".
 *
 * So the recount lives here. The rows are the source, the summaries are
 * derived, and a summary that disagrees with the rows fails the build
 * the way `docs-consistency.test.ts` fails it when a fact written in two
 * places moves in one of them.
 *
 * ── What it deliberately does not do ────────────────────────────────
 *
 * It does not rewrite the document. A test that fixed the table would
 * make the tables true and the *prose* around them quietly false —
 * "three branches hold work `main` does not" is a sentence with a number
 * in it that no counter can maintain. Failing tells whoever changed a
 * status that two more lines need their attention, which is the whole
 * job.
 */

const CHECKLIST = path.resolve(__dirname, '..', '..', 'PATIENT_FRONTEND_CHECKLIST.md');
// CRLF on a Windows checkout (`core.autocrlf`) would leave a `\r` before
// every `$` the table patterns anchor on, and the by-phase table would
// read as empty — so the parser sees the document as the repository does.
const document = fs.readFileSync(CHECKLIST, 'utf8').replace(/\r\n/g, '\n');

const STATUSES = ['✅', '🟨', '🔴', '⬜', '➖'] as const;
type Status = (typeof STATUSES)[number];

type Tally = Record<Status, number>;

function emptyTally(): Tally {
  return { '✅': 0, '🟨': 0, '🔴': 0, '⬜': 0, '➖': 0 };
}

/**
 * Splits a markdown row on its real cell boundaries.
 *
 * `\|` inside a cell is an escaped pipe, not a boundary — D-05's
 * `booting \| authenticated \| unauthenticated` and K-01's context
 * vocabulary both contain them, and a naive `split('|')` reads their
 * status out of the wrong column and silently counts nothing.
 */
function cellsOf(row: string): string[] {
  return row.split(/(?<!\\)\|/);
}

/** Every phase row, tallied by phase. The rows are the source of truth. */
function tallyRows(): { byPhase: Map<string, Tally>; total: Tally } {
  const byPhase = new Map<string, Tally>();
  const total = emptyTally();
  let phase: string | undefined;

  for (const line of document.split('\n')) {
    // The Summary quotes row ids back (A-02 in the 🔴 table, the task
    // branches in the reconciliation notes). Counting stops before it.
    if (line.startsWith('## Summary')) break;

    const heading = /^## Phase ([A-Z]) — /.exec(line);
    if (heading?.[1] !== undefined) {
      phase = heading[1];
      byPhase.set(phase, emptyTally());
      continue;
    }

    const row = /^\| ([A-Z])-(\d+) \|/.exec(line);
    if (row === null || row[1] !== phase || phase === undefined) continue;

    const cell = cellsOf(line)[5] ?? '';
    const status = STATUSES.find((symbol) => cell.includes(symbol));

    // A row with no status symbol is a row nobody can read the state of,
    // which is a defect in the checklist rather than in this test.
    expect(status).toBeDefined();

    const tally = byPhase.get(phase);
    if (status !== undefined && tally !== undefined) {
      tally[status] += 1;
      total[status] += 1;
    }
  }

  return { byPhase, total };
}

/** Reads `| ✅ Done | **119** | … |` out of the by-status table. */
function statedByStatus(): Tally {
  const stated = emptyTally();

  for (const symbol of STATUSES) {
    const row = document
      .split('\n')
      .find((line) => line.startsWith(`| ${symbol} `) && /\|\s*\*\*\d+\*\*\s*\|/.test(line));

    expect(row).toBeDefined();

    const count = /\*\*(\d+)\*\*/.exec(row ?? '');
    expect(count?.[1]).toBeDefined();
    stated[symbol] = Number(count?.[1]);
  }

  return stated;
}

/** Reads the by-phase table: `| A Architecture | 7 | 0 | 1 | 0 | 0 | 8 |`. */
function statedByPhase(): Map<string, { tally: Tally; total: number }> {
  const stated = new Map<string, { tally: Tally; total: number }>();
  const start = document.indexOf('### By phase');
  expect(start).toBeGreaterThan(-1);

  for (const line of document.slice(start).split('\n')) {
    const match = /^\| ([A-Z]) [A-Za-z/ ]+ \|(.+)\|$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;

    const numbers = match[2]
      .split('|')
      .map((cell) => Number(cell.trim()))
      .filter((value) => !Number.isNaN(value));

    if (numbers.length !== 6) continue;

    stated.set(match[1], {
      tally: {
        '✅': numbers[0] ?? 0,
        '🟨': numbers[1] ?? 0,
        '🔴': numbers[2] ?? 0,
        '⬜': numbers[3] ?? 0,
        '➖': numbers[4] ?? 0,
      },
      total: numbers[5] ?? 0,
    });
  }

  return stated;
}

const counted = tallyRows();

describe('the by-status table is the rows, recounted', () => {
  it('agrees with every status symbol counted off the phase tables', () => {
    expect(statedByStatus()).toEqual(counted.total);
  });

  it('states a grand total that is the sum of its own five rows', () => {
    const stated = statedByStatus();
    const sum = STATUSES.reduce((running, symbol) => running + stated[symbol], 0);
    const row = document.split('\n').find((line) => line.startsWith('| **Total** |'));

    expect(row).toBeDefined();
    expect(/\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/.exec(row ?? '')?.[1]).toBe(String(sum));
  });
});

/**
 * Reads the by-phase table's own `| **Total** | 118 | … |` footer row.
 *
 * ── The fourth drift, and the one this file did not catch ────────────
 *
 * Every check above reads a **phase** row — `| A Architecture | … |` —
 * because `statedByPhase()`'s pattern requires a single capital letter
 * followed by a name. `| **Total** |` matches none of that, so the
 * footer of the table this file exists to verify was the one row in it
 * nothing read.
 *
 * It had drifted, and by the largest margin yet: the footer read
 * `43 🟨` and `35 ⬜` while its own columns summed to `49` and `29`.
 * Both tables still totalled 211, which is exactly why it survived four
 * recounts and a test — the grand total was right and the split inside
 * it was six rows out in each of two directions.
 *
 * The by-status table is checked against the rows, and the phase rows
 * are checked against the rows, so this footer is now checked against
 * **its own columns**. That is the claim it makes and the only one it
 * can get wrong on its own.
 */
function statedByPhaseTotal(): Tally {
  const start = document.indexOf('### By phase');
  const row = document
    .slice(start)
    .split('\n')
    .find((line) => line.startsWith('| **Total** |'));

  expect(row).toBeDefined();

  const numbers = [...(row ?? '').matchAll(/\*\*(\d+)\*\*/g)].map((match) => Number(match[1]));
  // Five statuses and the grand total.
  expect(numbers).toHaveLength(6);

  return {
    '✅': numbers[0] ?? 0,
    '🟨': numbers[1] ?? 0,
    '🔴': numbers[2] ?? 0,
    '⬜': numbers[3] ?? 0,
    '➖': numbers[4] ?? 0,
  };
}

describe('the by-phase table is the rows, recounted', () => {
  it('covers every phase in the document and invents none', () => {
    expect([...statedByPhase().keys()].sort()).toEqual([...counted.byPhase.keys()].sort());
  });

  it('foots to the sum of its own phase rows, status by status', () => {
    const summed = emptyTally();
    for (const { tally } of statedByPhase().values()) {
      for (const symbol of STATUSES) summed[symbol] += tally[symbol];
    }

    expect(statedByPhaseTotal()).toEqual(summed);
  });

  it('foots to the same five numbers the by-status table states', () => {
    // Belt and braces, and they fail differently: the check above says
    // the footer disagrees with the table above it, this one says the
    // two tables disagree with each other.
    expect(statedByPhaseTotal()).toEqual(statedByStatus());
  });

  it('states a grand total that is the sum of its own five statuses', () => {
    const footer = statedByPhaseTotal();
    const start = document.indexOf('### By phase');
    const row = document
      .slice(start)
      .split('\n')
      .find((line) => line.startsWith('| **Total** |'));
    const numbers = [...(row ?? '').matchAll(/\*\*(\d+)\*\*/g)].map((match) => Number(match[1]));

    expect(numbers[5]).toBe(STATUSES.reduce((running, symbol) => running + footer[symbol], 0));
  });

  it('agrees with each phase, and each phase sums to its own total', () => {
    for (const [phase, { tally, total }] of statedByPhase()) {
      expect({ phase, ...tally }).toEqual({ phase, ...counted.byPhase.get(phase) });
      expect({ phase, total }).toEqual({
        phase,
        total: STATUSES.reduce((running, symbol) => running + tally[symbol], 0),
      });
    }
  });
});

describe('the prose headings carry the same numbers as the tables', () => {
  // These are the three that drifted. A heading is where a reader looks
  // first and the least likely thing to be edited alongside a row.
  const HEADINGS: readonly { pattern: RegExp; status: Status }[] = [
    { pattern: /^### What the (\d+) ✅ rows are$/m, status: '✅' },
    { pattern: /^### What the (\d+) 🟨 rows are$/m, status: '🟨' },
    { pattern: /^### The (\d+) 🔴 rows$/m, status: '🔴' },
  ];

  it.each(HEADINGS)('the $status section heading', ({ pattern, status }) => {
    const heading = pattern.exec(document);

    expect(heading?.[1]).toBeDefined();
    expect({ status, count: Number(heading?.[1]) }).toEqual({
      status,
      count: counted.total[status],
    });
  });
});

/**
 * **The Files column names files that exist** — W-12.
 *
 * ── What this found ──────────────────────────────────────────────────
 *
 * Fourteen rows, all ✅ or 🟨, cited component files that had never been
 * written: `AllergyList.tsx`, `ConditionList.tsx`, `MedicationList.tsx`,
 * `HistoryTimeline.tsx`, `OpeningHours.tsx`, `DepartmentList.tsx`,
 * `SlotStep.tsx`, `ConfirmStep.tsx`, `CancelSheet.tsx`,
 * `RescheduleSheet.tsx`, `ProposalSheet.tsx`, `Composer.tsx` and
 * `handlers.ts`. The *work* was real in every case — the allergies list
 * renders, the booking flow has five steps, the composer sends — but it
 * lives inside the screen rather than in the file the row names, and a
 * reader following the column found nothing.
 *
 * That is the W-12 failure in its purest form: a fact written in two
 * places, one of which moved. The columns were corrected to name the
 * files that carry the work rather than the files a plan once imagined,
 * because extracting nine components to match a document would be
 * refactoring to satisfy prose.
 *
 * ── It replaces a narrower check, and the narrowness was the bug ────
 *
 * `docs-consistency.test.ts` carried one of these and it passed
 * throughout: it asked only about **✅** rows, and all fourteen offenders
 * were 🟨. It also split its cells on a bare `|`, which reads the wrong
 * column for the two rows whose text contains an escaped one. Both are
 * fixed here and the old one is gone — one place per fact.
 *
 * ── Why only ✅ and 🟨 ───────────────────────────────────────────────
 *
 * A ⬜ or 🔴 row names the file it *would* create — `ClaimRecordScreen`,
 * `features/ai/redFlags.ts` — and that is the column doing its job. The
 * claim being checked here is narrower and is the one that can rot: a
 * row that says the work is done, pointing at where it is not.
 */

/** Every path under the repository, excluding what is generated. */
function repositoryPaths(): Set<string> {
  const root = path.resolve(__dirname, '..', '..', '..');
  const skip = new Set(['node_modules', '.git', 'dist', 'coverage', '.expo', 'build']);
  const paths = new Set<string>();

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      paths.add(path.relative(root, full).split(path.sep).join('/'));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return paths;
}

const REPOSITORY_PATHS = repositoryPaths();

/**
 * The column writes paths the way a reader would say them — sometimes
 * from the repository root (`patient-app/docs/PERF.md`), sometimes from
 * `src/` (`features/health/hooks.ts`), sometimes just the file. A suffix
 * match takes all three without the column having to be rewritten into
 * one house style it has never used.
 */
function pathExists(token: string): boolean {
  const wanted = token.replace(/\/$/, '');
  if (REPOSITORY_PATHS.has(wanted)) return true;
  for (const candidate of REPOSITORY_PATHS) {
    if (candidate.endsWith(`/${wanted}`)) return true;
  }
  return false;
}

/** A cell entry that is meant to be a path, rather than prose or a glob. */
function pathLikeTokens(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)]
    .map((match) => (match[1] ?? '').trim())
    .filter((token) => token !== '' && !token.includes(' ') && !token.includes('*'))
    .filter(
      (token) => token.endsWith('/') || /\.(tsx?|md|json|mjs|js|prisma|ya?ml|css)$/.test(token),
    );
}

describe('a done row points at work that is where it says it is (W-12)', () => {
  const rows: { id: string; files: string }[] = [];

  for (const line of document.split('\n')) {
    if (line.startsWith('## Summary')) break;
    if (!/^\| [A-Z]-\d+ \|/.test(line)) continue;
    const cells = cellsOf(line);
    const status = cells[5] ?? '';
    if (!status.includes('✅') && !status.includes('🟨')) continue;
    rows.push({ id: (cells[1] ?? '').trim(), files: cells[6] ?? '' });
  }

  it('reads the rows it is meant to, so an empty scan cannot pass', () => {
    // The row ids move; the count does not drop to zero without someone
    // noticing. This is the assertion that stops a parser change from
    // turning the check below into a no-op.
    expect(rows.length).toBeGreaterThan(100);
  });

  it('names nothing that does not exist', () => {
    const missing = rows.flatMap(({ id, files }) =>
      pathLikeTokens(files)
        .filter((token) => !pathExists(token))
        .map((token) => `${id} → ${token}`),
    );

    expect(missing).toEqual([]);
  });
});
