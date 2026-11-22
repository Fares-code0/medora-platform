import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAst } from 'rollup/parseAst';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  assertNoMocksRequested,
  CLIENT_AUTHORIZATION_MODULES,
  countSeamCalls,
  DEMO_FIXTURE_MODULES,
  findMockLeaks,
  isDemoFixtureModule,
  isMockAdapterModule,
  MOCK_BOUNDARY_EXEMPTIONS,
  MOCK_BOUNDARY_MARKERS,
  rewriteSeamCalls,
} from './mock-boundary';

/**
 * The mock-backend boundary (RM M40.4).
 *
 * On a real production build the guard finds nothing, so a violation exists
 * only here. What rots silently is pinned: the rewrite must reach every seam
 * the source contains, in whatever shape it is written; the classifiers must
 * recognise the real adapters and fixtures (and spare the D-09 exemption); and
 * every marker must still be a string the demo data actually contains.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../src');
const src = (path: string) => readFileSync(resolve(srcRoot, path), 'utf8');
const parse = (code: string) => parseAst(code);

/**
 * The whole-tree scan below walks `src/` and transpiles every seam module (~1 s when
 * run alone). Under a full-suite run it shares the CPU with every other
 * worker and overran Vitest's 5 s default — a load flake, not a slow check.
 * 30 s gives it room without hiding a genuine hang; no assertion changes.
 */
const WHOLE_TREE_SCAN_TIMEOUT_MS = 30_000;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.(test|stories|d)\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('the seam rewrite', () => {
  it('rewrites a seam to its HTTP side, whatever the arguments look like', () => {
    const code = [
      'export const a = selectService({ mock: mockA, http: httpA });',
      'export const b = selectService({',
      '  mock: (id) => Promise.resolve(seed(id)),',
      '  http: fetchB,',
      '});',
      'export const c = selectService({ mock: { read: () => 1 }, http: live ? x : y });',
      'const after = 1;',
    ].join('\n');

    const result = rewriteSeamCalls(code, parse);

    expect(result.count).toBe(3);
    expect(result.code).toContain('export const a = (httpA);');
    // The removed lines are kept as blank lines before the statement's `;`.
    expect(result.code).toMatch(/export const b = \(fetchB\)\n+;/);
    expect(result.code).toContain('export const c = (live ? x : y);');
    expect(result.code).not.toMatch(/mockA|seed\(|read:/);
    // Lines after a collapsed call stay on the line the sourcemap expects.
    expect(result.code.split('\n').indexOf('const after = 1;')).toBe(6);
  });

  it('leaves a call with no mock side alone', () => {
    const code = 'selectService({ http: httpA });';
    expect(rewriteSeamCalls(code, parse)).toEqual({ code, count: 0 });
  });

  it(
    'reaches every seam the source contains — generic, inline or plain',
    () => {
      const files = sourceFiles(srcRoot).filter((file) => !file.endsWith(join('api', 'seam.ts')));
      const missed: string[] = [];
      let total = 0;

      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (!source.includes('selectService')) continue;
        // The production build rewrites compiled JavaScript; test the same kind
        // of input. (TypeScript's transpiler rather than esbuild, which refuses
        // the jsdom environment the suite runs in.)
        const { outputText: code } = ts.transpileModule(source, {
          fileName: file,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        });
        const calls = countSeamCalls(code, parse);
        total += calls;
        const rewritten = rewriteSeamCalls(code, parse);
        if (rewritten.count !== calls || countSeamCalls(rewritten.code, parse) !== 0) {
          missed.push(relative(srcRoot, file));
        }
      }

      expect(missed).toEqual([]);
      // The production build reports the same figure; a drop means a seam left.
      expect(total).toBeGreaterThanOrEqual(29);
    },
    WHOLE_TREE_SCAN_TIMEOUT_MS,
  );
});

describe('the classifiers', () => {
  it.each([
    '/repo/frontend/src/features/auth/mock/users.ts',
    '/repo/frontend/src/features/doctor/labs/mock/mock-lab-service.ts',
    '/repo/frontend/src/features/admin/doctors/api/mock-doctors-service.ts',
    '/repo/frontend/src/features/shared-domain/patient-identity/mock-directory.ts',
    'C:\\repo\\frontend\\src\\features\\doctor\\pharmacy\\mock\\mock-prescription-service.ts',
  ])('marks %s as a mock adapter', (id) => {
    expect(isMockAdapterModule(id)).toBe(true);
  });

  it.each([
    '/repo/frontend/src/features/shared-domain/patient-identity/roster.ts',
    '/repo/frontend/src/features/shared-domain/lab-studies/corpus.ts',
    '/repo/frontend/src/features/doctor/reports/model/mock-data.ts',
    '/repo/frontend/src/features/doctor/patients/model/profile-mock-data.ts',
    '/repo/frontend/src/features/admin/api/admin-settings.api.ts',
  ])('marks %s as a demo fixture', (id) => {
    expect(isDemoFixtureModule(id)).toBe(true);
  });

  it.each([
    // D-09: the disclosed mock assistant ships until Phase 28.
    '/repo/frontend/src/features/doctor/ai/mock/mock-ai-service.ts',
    '/repo/frontend/src/features/doctor/ai/model/store.ts',
    // Production code that sits beside demo data.
    '/repo/frontend/src/features/doctor/settings/model/defaults.ts',
    '/repo/frontend/src/features/doctor/labs/http/http-lab-service.ts',
    '/repo/frontend/src/features/shared-domain/clinic-operations/store.ts',
    '/repo/frontend/src/api/seam.ts',
    '/repo/frontend/node_modules/some-lib/mock/index.js',
  ])('marks %s as neither', (id) => {
    expect(isMockAdapterModule(id)).toBe(false);
    expect(isDemoFixtureModule(id)).toBe(false);
  });

  it('names fixtures and exemptions that exist', () => {
    const paths = [
      ...DEMO_FIXTURE_MODULES,
      ...Object.keys(MOCK_BOUNDARY_EXEMPTIONS).map((fragment) => fragment.replace(/\/$/, '')),
    ];
    for (const path of paths) {
      expect(() => statSync(resolve(srcRoot, path)), path).not.toThrow();
    }
  });

  it('recognises the real adapters behind the seams', () => {
    for (const path of [
      'features/auth/mock/mock-auth-service.ts',
      'features/doctor/patients/mock/mock-profile-service.ts',
      'features/admin/access/mock-access-service.ts',
      'features/admin/appointments/api/mock-oversight-service.ts',
    ]) {
      expect(isMockAdapterModule(resolve(srcRoot, path)), path).toBe(true);
    }
  });
});

describe('the marker list', () => {
  it('still matches the demo data it is meant to detect', () => {
    const sources = [
      src('features/auth/mock/users.ts'),
      src('features/shared-domain/clinic-operations/store.ts'),
      src('features/shared-domain/patient-identity/roster.ts'),
    ].join('\n');
    for (const marker of MOCK_BOUNDARY_MARKERS) {
      expect(sources, `marker "${marker}" no longer appears in the demo data`).toContain(marker);
    }
  });
});

describe('the scan', () => {
  it('names a rendered adapter, a rendered fixture and a surviving marker', () => {
    const findings = findMockLeaks([
      {
        fileName: 'assets/index.js',
        code: 'const p="Medora123!"',
        renderedModuleIds: [
          '/r/src/features/auth/mock/users.ts',
          '/r/src/features/shared-domain/patient-identity/roster.ts',
          '/r/src/main.tsx',
        ],
      },
      { fileName: 'assets/clean.js', code: 'ok', renderedModuleIds: ['/r/src/app/App.tsx'] },
    ]);

    expect(findings).toEqual([
      'assets/index.js bundles features/auth/mock/users.ts, features/shared-domain/patient-identity/roster.ts',
      'assets/index.js carries "Medora123!"',
    ]);
  });

  it('names a browser-side authorization provider (RM M40.5)', () => {
    for (const path of CLIENT_AUTHORIZATION_MODULES) {
      expect(() => statSync(resolve(srcRoot, path)), path).not.toThrow();
    }
    expect(
      findMockLeaks([
        {
          fileName: 'assets/PhiAccessProvider.js',
          code: '',
          renderedModuleIds: ['/r/src/features/admin/phi/PhiAccessProvider.tsx'],
        },
        {
          fileName: 'assets/ServerPhiAccessProvider.js',
          code: '',
          renderedModuleIds: ['/r/src/features/admin/phi/ServerPhiAccessProvider.tsx'],
        },
      ]),
    ).toEqual(['assets/PhiAccessProvider.js bundles features/admin/phi/PhiAccessProvider.tsx']);
  });

  it('finds nothing in a clean bundle, the D-09 exemption included', () => {
    expect(
      findMockLeaks([
        {
          fileName: 'assets/index.js',
          code: 'fetch("/api/v1/auth/login")',
          renderedModuleIds: ['/r/src/features/doctor/ai/mock/mock-ai-service.ts'],
        },
      ]),
    ).toEqual([]);
  });
});

describe('a production build asked for mocks', () => {
  it('refuses, rather than silently building without them', () => {
    expect(() => assertNoMocksRequested(true, 'true')).toThrow(/build:demo/);
  });

  it.each([
    [true, 'false'],
    [true, undefined],
    [false, 'true'],
  ] as const)('allows production=%s with VITE_ENABLE_MOCKS=%s', (production, raw) => {
    expect(() => assertNoMocksRequested(production, raw)).not.toThrow();
  });
});
