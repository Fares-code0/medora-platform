import type { Plugin } from 'vite';

/**
 * The mock-backend boundary (RM M40.4) — a production build must not be able
 * to load the in-browser mock backend, and must not carry its adapters.
 *
 * ## What used to happen
 *
 * `selectService({ mock, http })` (`src/api/seam.ts`) chose an adapter at
 * *runtime*, on `env.enableMocks`, which `configs/env.ts` parses out of
 * `import.meta.env` with zod. Rollup cannot see through a zod parse, so
 * neither branch was ever dead to it: a `VITE_ENABLE_MOCKS=false` production
 * bundle carried every mock adapter, its seeded stores, and the mock auth
 * accounts with their shared password. Measured before this file existed:
 * 37 mock or seed modules in the live bundle, the password in `index-*.js`.
 * Selection kept them unreachable; nothing kept them out.
 *
 * ## The mechanism — three parts, each checked
 *
 * 1. **A compile-time constant.** `vite.config.ts` defines
 *    `import.meta.env.MEDORA_MOCKS_STRIPPED` as `true` for a `mode ===
 *    'production'` build. `configs/env.ts` and `api/seam.ts` read it, so in
 *    such a build `env.enableMocks` is `false` and `selectService` returns
 *    the HTTP adapter whatever the environment says. That is the
 *    *enforcement*: no runtime value can select a mock. Every other config
 *    (the dev server, `build:demo`, vitest) leaves it undefined — off.
 * 2. **A rewrite.** `mockSeamRewritePlugin` replaces each
 *    `selectService({ mock: A, http: B })` with `B` before bundling, so the
 *    mock adapter is no longer referenced and tree shaking removes it. It
 *    records how many call sites it rewrote, so the scan can tell a build
 *    where it ran from one where it silently matched nothing.
 * 3. **The proof.** `mockBoundaryPlugin` reads the emitted chunks and fails
 *    the build if a mock adapter module was rendered into any of them, if the
 *    mock password survived as text, or if the rewrite did not run.
 *
 * Keyed off the build **mode**, like the demo-access boundary and for the
 * same reason (see `demo-access-boundary.ts`): `NODE_ENV` is configured by
 * the host. The public demo is `npm run build:demo` (`--mode development`)
 * and keeps its mock backend, as `DEPLOYMENT.md` documents.
 *
 * ## The one exemption
 *
 * The Medora AI assistant ships its mock adapter on purpose. Owner decision
 * D-09 holds the live assistant until Phase 28 binds the hospital server-side
 * (DR-12), and its replies carry a mock-output disclaimer
 * (`features/doctor/ai/service.ts`). Removing it would delete a route, not a
 * mock. It is named here so that exemption is a reviewed line, not an
 * accident of the classifier.
 */

/** The define key `vite.config.ts` sets to `true` for a production build. */
export const MOCKS_STRIPPED_FLAG = 'import.meta.env.MEDORA_MOCKS_STRIPPED';

/**
 * Mock modules a production bundle may still carry, each with its decision.
 * Matched as a path fragment under `src/`.
 */
export const MOCK_BOUNDARY_EXEMPTIONS: Readonly<Record<string, string>> = {
  'features/doctor/ai/mock/': 'D-09 — disclosed mock assistant until Phase 28',
  'features/doctor/ai/model/store.ts':
    'D-09 — the disclosed assistant keeps its conversations here',
};

/**
 * Demo *fixture* modules — seeded datasets and the demo stores built on them.
 * Unlike a mock adapter they are not selected by a seam; they are what the
 * mock adapters (and demo-only screens) read. Each was found in a live bundle
 * and classified by reading it: every one is demo data or demo persistence
 * and nothing else. A module that mixes live code with a demo store (the
 * clinic-operations store, whose live half refuses every call) is not listed;
 * the markers below cover its demo half.
 */
export const DEMO_FIXTURE_MODULES: readonly string[] = [
  'features/shared-domain/patient-identity/roster.ts',
  'features/shared-domain/lab-studies/corpus.ts',
  'features/shared-domain/lab-studies/store.ts',
  'features/shared-domain/conversations/seed.ts',
  'features/shared-domain/conversations/store.ts',
  'features/shared-domain/prescriptions/store.ts',
  'features/admin/api/admin-settings.api.ts',
  'features/admin/admin-profile.ts',
  'features/admin/logs/api/logs.api.ts',
  'features/admin/reports/api/reports.api.ts',
  'features/admin/doctors/api/doctors.api.ts',
  'features/admin/patients/api/patients.api.ts',
  'features/admin/appointments/api/oversight.api.ts',
  'features/admin/communications/communications.api.ts',
  'features/doctor/notifications/model/store.ts',
  'features/doctor/reports/model/store.ts',
];

/**
 * Client-side authorization (RM M40.5) — providers that decide in the browser
 * whether something may be revealed, and keep the record of it there. A
 * production build mounts the server-only PHI gate and no content-access gate
 * (`app/router/index.tsx`), so neither of these may reach its bundle: nothing
 * in a live browser's memory or storage may stand as proof of authorization.
 */
export const CLIENT_AUTHORIZATION_MODULES: readonly string[] = [
  'features/admin/phi/PhiAccessProvider.tsx',
  'features/admin/communications/ContentAccessProvider.tsx',
];

/**
 * Strings that exist only in the mock backend and would be usable against it.
 * `Medora123!` is the shared password of every seeded mock account
 * (`features/auth/mock/users.ts`); finding it in a production chunk means a
 * working demo credential shipped.
 */
export const MOCK_BOUNDARY_MARKERS: readonly string[] = [
  'Medora123!',
  // The clinic-operations demo store's localStorage key — its demo half, in a
  // module whose live half ships.
  'medora.admin.clinic.v1',
  // The first demo patient and the demo doctor of the seeded roster
  // (`patient-identity/roster.ts`): the identity every demo dataset reuses.
  'Khaled Nassar',
  'Dr. Amelia Chen',
];

function srcPath(id: string): string | null {
  const path = (id.replace(/\\/g, '/').split('?')[0] ?? '').replace(/^\0/, '');
  const at = path.lastIndexOf('/src/');
  return at === -1 ? null : path.slice(at + '/src/'.length);
}

/**
 * Is this module a mock *adapter* — the thing a seam selects in mock mode?
 *
 * Everything under a `mock/` directory, and any `mock-*.ts(x)` file, except
 * `mock-data.ts`: several of those hold types and display constants that
 * HTTP adapters import legitimately (FE-10 "Mock Data Audit"), so a ban by
 * file name would be wrong about them. The password marker covers the one
 * thing in them that must never ship.
 */
export function isMockAdapterModule(id: string): boolean {
  const path = srcPath(id);
  if (path === null || !path.startsWith('features/')) return false;
  if (/\.(test|stories)\.tsx?$/.test(path)) return false;
  if (Object.keys(MOCK_BOUNDARY_EXEMPTIONS).some((fragment) => path.includes(fragment))) {
    return false;
  }
  const file = path.split('/').pop() ?? '';
  if (path.includes('/mock/')) return true;
  return /^mock-.+\.tsx?$/.test(file) && !/^mock-data\.tsx?$/.test(file);
}

/**
 * Is this module a demo fixture — `DEMO_FIXTURE_MODULES`, or any
 * `mock-data.ts` / `profile-mock-data.ts`? Since RM M40.4 moved the
 * production constants that used to live in two of those files elsewhere
 * (`settings/model/defaults.ts`; the reports adapter's capabilities), every
 * remaining `mock-data.ts` is demo data.
 */
export function isDemoFixtureModule(id: string): boolean {
  const path = srcPath(id);
  if (path === null || !path.startsWith('features/')) return false;
  if (/\.(test|stories)\.tsx?$/.test(path)) return false;
  if (Object.keys(MOCK_BOUNDARY_EXEMPTIONS).some((fragment) => path.includes(fragment))) {
    return false;
  }
  if (DEMO_FIXTURE_MODULES.includes(path)) return true;
  const file = path.split('/').pop() ?? '';
  return /^(profile-)?mock-data\.ts$/.test(file);
}

/** The slice of an ESTree node this rewrite reads. */
interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** Parses JavaScript into ESTree — Rollup's `this.parse`, or `parseAst` from `vite` in tests. */
export type ParseJs = (code: string) => unknown;

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

function propertyNamed(objectExpr: AstNode, name: string): AstNode | null {
  for (const prop of objectExpr['properties'] as unknown[]) {
    if (!isNode(prop) || prop.type !== 'Property') continue;
    const key = prop['key'];
    if (isNode(key) && key.type === 'Identifier' && key['name'] === name) {
      return prop['value'] as AstNode;
    }
  }
  return null;
}

/**
 * Every `selectService({ mock: …, http: … })` call in `code`, by source range,
 * with the range of its `http` expression. Structural rather than textual, so
 * any argument shape is found: identifiers, inline arrows, object literals,
 * conditionals. (A textual match on identifiers alone missed six seams whose
 * mock side is written inline — the lab-studies corpus and the demo-only admin
 * sections among them — and their demo data shipped.)
 */
function findSeamCalls(
  program: unknown,
): { readonly start: number; readonly end: number; readonly http: AstNode }[] {
  const found: { start: number; end: number; http: AstNode }[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isNode(node)) return;
    if (node.type === 'CallExpression') {
      const callee = node['callee'];
      const args = node['arguments'] as unknown[];
      const arg = args[0];
      if (
        isNode(callee) &&
        callee.type === 'Identifier' &&
        callee['name'] === 'selectService' &&
        args.length === 1 &&
        isNode(arg) &&
        arg.type === 'ObjectExpression'
      ) {
        const http = propertyNamed(arg, 'http');
        if (http !== null && propertyNamed(arg, 'mock') !== null) {
          // Outermost calls only: no seam nests inside another, and a
          // rewrite of the outer call keeps its HTTP side's text verbatim.
          found.push({ start: node.start, end: node.end, http });
          return;
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'type' && key !== 'start' && key !== 'end') visit(value);
    }
  };
  visit(program);
  return found.sort((a, b) => a.start - b.start);
}

/** How many `selectService({ mock, http })` calls `code` holds. */
export function countSeamCalls(code: string, parse: ParseJs): number {
  return findSeamCalls(parse(code)).length;
}

/**
 * Rewrites every seam call in `code` (JavaScript) to its HTTP expression. Pure,
 * for tests. Line breaks inside a removed call are kept, so every line after it
 * stays where the sourcemap says it is.
 */
export function rewriteSeamCalls(
  code: string,
  parse: ParseJs,
): { readonly code: string; readonly count: number } {
  const calls = findSeamCalls(parse(code));
  let out = code;
  for (const call of [...calls].reverse()) {
    const httpText = code.slice(call.http.start, call.http.end);
    const removedLines = code.slice(call.start, call.end).split('\n').length;
    const padding = '\n'.repeat(Math.max(0, removedLines - httpText.split('\n').length));
    out = `${out.slice(0, call.start)}(${httpText})${padding}${out.slice(call.end)}`;
  }
  return { code: out, count: calls.length };
}

const rewrittenSites = new Map<string, number>();

/** `src/`-relative file → number of seam calls rewritten in it, this build. */
export function rewrittenSeamSites(): ReadonlyMap<string, number> {
  return rewrittenSites;
}

/**
 * Rewrites the seams of a production build. Normal order, so it runs after
 * Vite has compiled the TypeScript and JSX away and `this.parse` can read the
 * module as JavaScript.
 */
export function mockSeamRewritePlugin(options: { readonly enabled: boolean }): Plugin {
  return {
    name: 'medora:mock-seam-rewrite',
    apply: 'build',
    buildStart() {
      rewrittenSites.clear();
    },
    transform(code, id) {
      if (!options.enabled) return null;
      const path = srcPath(id);
      if (path === null || path === 'api/seam.ts' || !/\.tsx?$/.test(path)) return null;
      // The rewrite runs on compiled JavaScript, after esbuild has decided
      // which imports to keep, so a seam's mock import outlives the seam. A
      // mock module's top-level effects (seeding a demo store) are exactly
      // what a production build must not run, so it is declared free of them
      // and Rollup drops it once nothing reads its exports. Demo fixtures are
      // treated the same way: a live module that still reads one keeps it,
      // and the scan below names it.
      if (isMockAdapterModule(id) || isDemoFixtureModule(id)) {
        return { code, map: null, moduleSideEffects: false };
      }
      if (!code.includes('selectService')) return null;
      const result = rewriteSeamCalls(code, (source) => this.parse(source));
      if (result.count === 0) return null;
      rewrittenSites.set(path, result.count);
      return { code: result.code, map: null };
    },
  };
}

/** A bundle chunk reduced to what the scan needs. */
export interface ScannedChunk {
  readonly fileName: string;
  readonly code: string;
  /** Ids of the modules Rollup actually rendered code from into this chunk. */
  readonly renderedModuleIds: readonly string[];
}

/** Findings rather than a throw, so the tests can read them. */
export function findMockLeaks(chunks: readonly ScannedChunk[]): string[] {
  const findings: string[] = [];
  for (const chunk of chunks) {
    const modules = chunk.renderedModuleIds.filter(
      (id) =>
        isMockAdapterModule(id) ||
        isDemoFixtureModule(id) ||
        CLIENT_AUTHORIZATION_MODULES.includes(srcPath(id) ?? ''),
    );
    if (modules.length > 0) {
      const names = modules.map((id) => srcPath(id) ?? id);
      findings.push(`${chunk.fileName} bundles ${names.sort().join(', ')}`);
    }
    const markers = MOCK_BOUNDARY_MARKERS.filter((marker) => chunk.code.includes(marker));
    if (markers.length > 0) {
      findings.push(`${chunk.fileName} carries ${markers.map((m) => `"${m}"`).join(', ')}`);
    }
  }
  return findings.sort();
}

/**
 * The build refuses a request it would otherwise silently ignore: the
 * constant compiles the mock backend out of a production build, so
 * `VITE_ENABLE_MOCKS=true` there would describe a bundle that does not exist.
 * Same rule as `resolveEnableMocks` in `configs/env.ts`: fail loudly.
 */
export function assertNoMocksRequested(isProductionBuild: boolean, raw: string | undefined): void {
  if (isProductionBuild && raw === 'true') {
    throw new Error(
      'VITE_ENABLE_MOCKS=true cannot be honoured by a production build (`vite build`).\n' +
        'The mock backend is compiled out of it (scripts/mock-boundary.ts, RM M40.4).\n' +
        'For the seeded demo, run `npm run build:demo`; for production, set\n' +
        'VITE_ENABLE_MOCKS=false (or remove it) and point VITE_API_BASE_URL at the API.',
    );
  }
}

/** Verifies the emitted bundle of a production build. */
export function mockBoundaryPlugin(options: { readonly enabled: boolean }): Plugin {
  return {
    name: 'medora:mock-boundary',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (!options.enabled) {
        console.log('· Mock boundary: skipped — this is not a production build');
        return;
      }

      const sites = [...rewrittenSites.keys()].sort();
      if (sites.length === 0) {
        this.error(
          '\n✖ The mock-seam rewrite did not run for this build.\n\n' +
            'mockSeamRewritePlugin rewrote no selectService({ mock, http }) call, so every\n' +
            'mock adapter is still referenced and only the runtime flag stands between\n' +
            'it and a user. Check that mockSeamRewritePlugin({ enabled: true }) is\n' +
            'registered in vite.config.ts for production builds.\n',
        );
        return;
      }

      const chunks: ScannedChunk[] = Object.values(bundle)
        .filter((output): output is Extract<typeof output, { type: 'chunk' }> => {
          return output.type === 'chunk';
        })
        .map((chunk) => ({
          fileName: chunk.fileName,
          code: chunk.code,
          renderedModuleIds: Object.entries(chunk.modules)
            .filter(([, module]) => module.renderedLength > 0)
            .map(([id]) => id),
        }));

      const findings = findMockLeaks(chunks);
      if (findings.length > 0) {
        this.error(
          '\n✖ The mock backend reached the production bundle:\n\n' +
            findings.map((finding) => `  ${finding}`).join('\n') +
            '\n\nA production build rewrites every selectService({ mock, http }) to its\n' +
            'HTTP adapter (scripts/mock-boundary.ts), so no mock adapter should be\n' +
            'referenced. One is: either a seam is written in a shape the rewrite does\n' +
            'not match, or production code imports a mock module directly. Route it\n' +
            'through a seam, or gate it on import.meta.env.MEDORA_MOCKS_STRIPPED.\n',
        );
        return;
      }

      const total = [...rewrittenSites.values()].reduce((sum, n) => sum + n, 0);
      console.log(
        `✓ Mock boundary: ${total} seams in ${sites.length} files rewritten to HTTP; ` +
          'no mock adapter or mock credential in the production bundle',
      );
    },
  };
}
