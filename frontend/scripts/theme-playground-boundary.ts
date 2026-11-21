import type { Plugin } from 'vite';

/**
 * Theme Playground boundary — the development-only colour editor
 * (`src/features/theme-playground/`) must never be in a build output.
 *
 * ── Why not `import.meta.env.DEV` ────────────────────────────────────
 * The public Vercel demo is built with `npm run build:demo`, which sets
 * `NODE_ENV=development` so that `import.meta.env.DEV` is true there (see
 * DEPLOYMENT.md, "Demo posture"). A playground gated on `DEV` alone was
 * therefore compiled into the public demo. `DEV` answers "is this React's
 * development build", not "is a developer running this on their machine".
 *
 * ── The gate ─────────────────────────────────────────────────────────
 * `themePlaygroundEnabled` is true ONLY for the local dev server
 * (`command === 'serve'`), in development mode, with
 * `VITE_APP_ENV=development` — the value `.env.example` ships and the
 * README's setup copies. Anything else is off, including an unset variable,
 * and including every `vite build` whatever its mode or environment: a build
 * is an artifact that can be deployed, and a dev tool has no business in
 * one. vite.config.ts compiles the answer into the bundle as the constant
 * `import.meta.env.MEDORA_THEME_PLAYGROUND`; a config that does not define it
 * (vitest, vite.artifact.config.ts) reads `undefined`, which is also off.
 *
 * ── The guard ────────────────────────────────────────────────────────
 * `themePlaygroundBoundaryPlugin` runs on EVERY build — unlike the
 * demo-access boundary, which the demo build opts out of on purpose — and
 * fails it if any emitted chunk contains a playground module (checked by
 * module id, so minification or renaming cannot hide it) or one of the
 * marker strings the playground cannot work without.
 */

export const THEME_PLAYGROUND_FLAG = 'import.meta.env.MEDORA_THEME_PLAYGROUND';

export interface GateInput {
  /** Vite's `command`: `'serve'` for the dev server, `'build'` for `vite build`. */
  readonly command: string;
  readonly mode: string;
  /** `VITE_APP_ENV` as Vite loaded it, `undefined` when unset. */
  readonly appEnv: string | undefined;
}

export function themePlaygroundEnabled({ command, mode, appEnv }: GateInput): boolean {
  return command === 'serve' && mode === 'development' && appEnv === 'development';
}

/**
 * Strings the playground cannot function without: its route, its storage
 * namespace, its interchange format, its title. A copy that survived under
 * another module name would still carry these.
 */
export const THEME_PLAYGROUND_MARKERS: readonly string[] = [
  '/dev/theme-playground',
  'medora.dev.theme-playground',
  'medora-theme@1',
  'Theme Playground',
];

export function isThemePlaygroundModule(id: string): boolean {
  const path = id.replace(/\\/g, '/').split('?')[0] ?? '';
  return path.includes('/src/features/theme-playground/');
}

export interface BundledChunk {
  readonly fileName: string;
  readonly code: string;
  /** Every module id Rollup placed in this chunk. */
  readonly moduleIds: readonly string[];
}

export function findThemePlaygroundLeaks(chunks: readonly BundledChunk[]): string[] {
  const findings: string[] = [];
  for (const chunk of chunks) {
    const modules = chunk.moduleIds.filter(isThemePlaygroundModule);
    if (modules.length > 0) {
      const names = modules.map((id) => id.replace(/\\/g, '/').split('/src/')[1] ?? id);
      findings.push(`${chunk.fileName} bundles ${names.sort().join(', ')}`);
    }
    const markers = THEME_PLAYGROUND_MARKERS.filter((marker) => chunk.code.includes(marker));
    if (markers.length > 0) {
      findings.push(`${chunk.fileName} carries ${markers.map((m) => `"${m}"`).join(', ')}`);
    }
  }
  return findings.sort();
}

export function themePlaygroundBoundaryPlugin(): Plugin {
  return {
    name: 'medora:theme-playground-boundary',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks: BundledChunk[] = Object.values(bundle)
        .filter((output): output is Extract<typeof output, { type: 'chunk' }> => {
          return output.type === 'chunk';
        })
        .map((chunk) => ({
          fileName: chunk.fileName,
          code: chunk.code,
          moduleIds: Object.keys(chunk.modules),
        }));

      const findings = findThemePlaygroundLeaks(chunks);
      if (findings.length > 0) {
        this.error(
          '\n✖ The development-only Theme Playground reached a build output:\n\n' +
            findings.map((finding) => `  ${finding}`).join('\n') +
            '\n\nThe playground runs on the local dev server only. Every `vite build`\n' +
            '— the production build AND the public demo (`npm run build:demo`) —\n' +
            'must exclude it. Check that nothing imports src/features/theme-playground/\n' +
            'outside the route in app/router/index.tsx, and that the route is still\n' +
            `gated on ${THEME_PLAYGROUND_FLAG} (scripts/theme-playground-boundary.ts).\n`,
        );
        return;
      }
      console.log('✓ Theme Playground boundary: no playground code in this build');
    },
  };
}
