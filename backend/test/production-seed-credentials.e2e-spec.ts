import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * RM M38.4's verify step — "prod seed script contains no `Medora123!` /
 * OTP `123456` (grep in CI)" — as a test, so the backend job that CI
 * already runs on every pull request performs the grep. No workflow
 * change: `npm run test` is the CI step.
 *
 * Two surfaces can put a credential into a live database or a running
 * deployment, and both are checked:
 *
 * 1. **What `npm run db:seed:production` loads.** Not a fixed file list:
 *    the import graph is walked from `prisma/seed-production.ts`, so a
 *    file added to that path later is checked without anyone remembering
 *    to list it. The demo layer (`prisma/seed/demo.ts`) must not be in
 *    the graph at all — it is where the mock roster lives, and it refuses
 *    production at run time; this keeps it out at build time as well.
 * 2. **The application and its CLIs** (`src/`, specs excluded): the code
 *    every environment runs, production included.
 *
 * The root README publishes `Medora123!` for the frontend's mock auth
 * service. This is what confirms, on the backend side, that the value is
 * a mock fixture only: no backend code path a real environment executes
 * carries it.
 */

const BACKEND = resolve(__dirname, '..');
const PRODUCTION_SEED_ENTRY = join(BACKEND, 'prisma', 'seed-production.ts');
const DEMO_LAYER = join(BACKEND, 'prisma', 'seed', 'demo.ts');

/** The demo password, and the mock OTP as a standalone six-digit literal. */
const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'demo password Medora123!', pattern: /Medora123!/ },
  { name: 'mock OTP 123456', pattern: /(?<![0-9])123456(?![0-9])/ },
  // A pre-computed password hash would be a credential by another name.
  { name: 'argon2 password hash', pattern: /\$argon2(?:id|i|d)\$v=\d+\$m=\d+/ },
];

/** Relative `import … from '…'` / `export … from '…'` specifiers. */
function relativeImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern =
    /(?:import|export)\s[^'";]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\s+['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every repository source file reachable from `entry` by relative imports.
 * Generated Prisma client code is skipped: it is emitted from the schema
 * and holds no seed data.
 */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of relativeImports(readFileSync(file, 'utf8'))) {
      const target = resolveModule(file, specifier);
      if (target === null) throw new Error(`unresolved import ${specifier} in ${file}`);
      if (!target.includes(`${join('src', 'generated')}`)) pending.push(target);
    }
  }
  return [...seen].sort();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

function violations(files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(
      ({ name }) => `${relative(BACKEND, file)}: ${name}`,
    );
  });
}

describe('RM M38.4 — no demo credential reaches a real environment', () => {
  const graph = importGraph(PRODUCTION_SEED_ENTRY);

  it('walks a real import graph for the production seed', () => {
    // The floor stops the check passing on an empty walk: the entry, the
    // production layer and its three seeders at least.
    expect(graph.length).toBeGreaterThanOrEqual(5);
    expect(graph).toContain(join(BACKEND, 'prisma', 'seed', 'production.ts'));
  });

  it('keeps the demo layer out of the production seed entirely', () => {
    expect(graph).not.toContain(DEMO_LAYER);
  });

  it('carries no demo password, mock OTP or password hash in anything the production seed loads', () => {
    expect(violations(graph)).toEqual([]);
  });

  it('carries none in the application or its CLIs', () => {
    const files = sourceFiles(join(BACKEND, 'src'));
    expect(files.length).toBeGreaterThan(100);
    expect(violations(files)).toEqual([]);
  });

  it('would catch them: the patterns match the values they guard against', () => {
    // Proves the check is load-bearing rather than vacuously green.
    expect(violations([DEMO_LAYER])).toContain('prisma/seed/demo.ts: demo password Medora123!');
    expect(FORBIDDEN[1]?.pattern.test("const otp = '123456';")).toBe(true);
    expect(FORBIDDEN[1]?.pattern.test('const id = 91234567;')).toBe(false);
    expect(FORBIDDEN[2]?.pattern.test('$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA')).toBe(true);
    // The format named in prose is not a hash.
    expect(
      FORBIDDEN[2]?.pattern.test('hashes carry their parameters in the `$argon2id$…` string'),
    ).toBe(false);
  });
});
