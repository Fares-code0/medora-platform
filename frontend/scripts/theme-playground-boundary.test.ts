import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  THEME_PLAYGROUND_FLAG,
  THEME_PLAYGROUND_MARKERS,
  findThemePlaygroundLeaks,
  isThemePlaygroundModule,
  themePlaygroundBoundaryPlugin,
  themePlaygroundEnabled,
} from './theme-playground-boundary';

/**
 * The Theme Playground boundary. Its correct behaviour is mostly FAILING a
 * build, and a real build never fails it, so the failure paths are exercised
 * here against synthetic bundles — the same arrangement as
 * demo-access-boundary.test.ts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, '..', path), 'utf8');

describe('the gate', () => {
  it.each([
    // [command, mode, VITE_APP_ENV, enabled]
    ['serve', 'development', 'development', true],
    ['serve', 'development', undefined, false],
    ['serve', 'development', 'staging', false],
    ['serve', 'development', 'production', false],
    ['serve', 'production', 'development', false],
    // Every build is off — including build:demo, and including a build:demo
    // somebody misconfigured with VITE_APP_ENV=development.
    ['build', 'production', 'development', false],
    ['build', 'development', 'staging', false],
    ['build', 'development', 'development', false],
    ['build', 'production', undefined, false],
  ] as const)('%s · mode %s · VITE_APP_ENV=%s → %s', (command, mode, appEnv, enabled) => {
    expect(themePlaygroundEnabled({ command, mode, appEnv })).toBe(enabled);
  });
});

describe('leak detection', () => {
  const clean = { fileName: 'assets/index.js', code: 'console.log(1)', moduleIds: ['/repo/frontend/src/main.tsx'] };

  it('finds a playground module by id, whatever the code looks like after minification', () => {
    const leaked = {
      fileName: 'assets/x.js',
      code: 'var a=1',
      moduleIds: ['/repo/frontend/src/features/theme-playground/model/presets.ts'],
    };
    expect(findThemePlaygroundLeaks([clean, leaked])).toEqual([
      'assets/x.js bundles features/theme-playground/model/presets.ts',
    ]);
  });

  it('finds the playground by its marker strings even under another module name', () => {
    const copied = { fileName: 'assets/y.js', code: 'const k="medora-theme@1"', moduleIds: ['/repo/src/other.ts'] };
    expect(findThemePlaygroundLeaks([copied])).toEqual(['assets/y.js carries "medora-theme@1"']);
  });

  it('recognises Windows paths and query suffixes', () => {
    expect(isThemePlaygroundModule('C:\\repo\\frontend\\src\\features\\theme-playground\\index.ts')).toBe(true);
    expect(isThemePlaygroundModule('/repo/frontend/src/features/theme-playground/x.tsx?import')).toBe(true);
    expect(isThemePlaygroundModule('/repo/frontend/src/features/doctor/x.tsx')).toBe(false);
  });

  it('reports nothing for a clean bundle', () => {
    expect(findThemePlaygroundLeaks([clean])).toEqual([]);
  });
});

describe('the plugin', () => {
  type GenerateBundle = (this: { error: (m: string) => never }, o: unknown, b: unknown) => void;
  const run = (bundle: Record<string, unknown>) => {
    const plugin = themePlaygroundBoundaryPlugin();
    const error = vi.fn((message: string) => {
      throw new Error(message);
    });
    const hook = plugin.generateBundle as unknown as GenerateBundle;
    return () => hook.call({ error: error }, {}, bundle);
  };

  it('runs on builds only, never on the dev server', () => {
    expect(themePlaygroundBoundaryPlugin().apply).toBe('build');
  });

  it('fails a build that contains a playground module', () => {
    const bundle = {
      'assets/a.js': {
        type: 'chunk',
        fileName: 'assets/a.js',
        code: 'x',
        modules: { '/r/frontend/src/features/theme-playground/pages/ThemePlaygroundPage.tsx': {} },
      },
    };
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(run(bundle)).toThrow(/Theme Playground reached a build output/);
  });

  it('passes a clean build', () => {
    const bundle = {
      'assets/a.js': { type: 'chunk', fileName: 'assets/a.js', code: 'x', modules: { '/r/src/main.tsx': {} } },
      'assets/a.js.map': { type: 'asset', fileName: 'assets/a.js.map', source: '"Theme Playground"' },
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(run(bundle)).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no playground code'));
  });
});

describe('the wiring', () => {
  it('registers the guard on every build and compiles the gate into the bundle', () => {
    const config = read('vite.config.ts');
    // Unconditional — not behind `isProductionBuild` like the demo-access guard.
    expect(config).toMatch(/^\s+themePlaygroundBoundaryPlugin\(\),$/m);
    expect(config).toContain('[THEME_PLAYGROUND_FLAG]: JSON.stringify(themePlayground)');
    expect(THEME_PLAYGROUND_FLAG).toBe('import.meta.env.MEDORA_THEME_PLAYGROUND');
  });

  it('gates the route on the flag, not on import.meta.env.DEV', () => {
    const router = read('src/app/router/index.tsx');
    const route = router.slice(router.indexOf('const devOnlyRoutes'), router.indexOf(': [];'));
    expect(route).toContain('import.meta.env.MEDORA_THEME_PLAYGROUND === true');
    expect(route).not.toContain('import.meta.env.DEV');
  });

  it('keeps every marker real — a marker the source no longer contains guards nothing', () => {
    const dir = resolve(here, '../src/features/theme-playground');
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [join(d, e.name)] : [],
      );
    const source = walk(dir).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const marker of THEME_PLAYGROUND_MARKERS) {
      // The route literal lives in the router, deliberately outside the feature.
      const where = marker === '/dev/theme-playground' ? read('src/app/router/index.tsx') : source;
      expect(where, `marker "${marker}"`).toContain(marker);
    }
  });

  it('is the only import of the feature outside the feature itself', () => {
    const src = resolve(here, '../src');
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [],
      );
    const importers = walk(src)
      .filter((f) => !f.includes(join('features', 'theme-playground')))
      .filter((f) => /['"]@\/features\/theme-playground/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(src.length + 1).split('\\').join('/'));
    expect(importers).toEqual(['app/router/index.tsx']);
  });
});
