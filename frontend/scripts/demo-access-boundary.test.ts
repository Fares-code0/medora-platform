import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEMO_ACCESS_MARKERS,
  DEMO_ACCESS_STUBS,
  demoAccessBoundaryPlugin,
  demoAccessStubPlugin,
  findDemoAccessLeaks,
  isDemoAccessModule,
  stubbedDemoModules,
} from './demo-access-boundary';

/**
 * The demo-access boundary guard.
 *
 * The guard's own correct behaviour is *finding nothing* on a real build,
 * so the only place a violation exists to check against is here. Two
 * things are worth proving:
 * that the scan catches a leak when there is one, and that the markers it
 * scans for are still the strings the source actually contains.
 *
 * The second is the one that rots. A guard whose markers no longer match
 * the code is a guard that passes every build while checking nothing, and
 * nothing else in the suite would notice.
 */

/*
 * `resolve` from the test file's own directory rather than
 * `new URL(relative, import.meta.url)`: the suite runs in the jsdom
 * environment, where relative URL resolution does not survive
 * `fileURLToPath` and silently yields `scripts/undefined`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = (path: string) => readFileSync(resolve(here, '../src', path), 'utf8');

describe('the marker list', () => {
  it('still matches the source it is meant to detect', () => {
    const sources = [src('features/auth/dev/DemoAccessPanel.tsx')].join('\n');

    for (const marker of DEMO_ACCESS_MARKERS) {
      expect(sources, `marker "${marker}" no longer appears in features/auth/dev/`).toContain(
        marker,
      );
    }
  });
});

describe('the production stubs', () => {
  /** Export names a module declares, in source order. */
  const exportsOf = (source: string) =>
    [...source.matchAll(/^export\s+(?:const|function)\s+(\w+)/gm)].map((m) => m[1]).sort();

  it.each([['DemoAccessPanel.tsx', 'features/auth/dev/DemoAccessPanel.tsx']])('for %s exports exactly what the real module exports', (stubName, realPath) => {
    /*
     * The stub replaces the real module at build time, so a missing export
     * is a broken production build. Rollup would say so, but only at
     * deploy time and only after everything else has passed — this says so
     * in CI, naming the module.
     */
    const stub = DEMO_ACCESS_STUBS[stubName];
    expect(stub, `no stub registered for ${stubName}`).toBeDefined();
    expect(exportsOf(stub ?? '')).toEqual(exportsOf(src(realPath)));
  });

  it('contains none of the markers it exists to keep out of the bundle', () => {
    for (const stub of Object.values(DEMO_ACCESS_STUBS)) {
      for (const marker of DEMO_ACCESS_MARKERS) {
        expect(stub).not.toContain(marker);
      }
    }
  });

  it('covers every module in the dev directory', () => {
    // A file added to features/auth/dev/ without a stub would be compiled
    // for real into a production build.
    const modules = readdirSync(resolve(here, '../src/features/auth/dev')).filter(
      (name) => /\.tsx?$/.test(name) && !name.includes('.test.'),
    );
    expect(modules.sort()).toEqual(Object.keys(DEMO_ACCESS_STUBS).sort());
  });
});

describe('the stub plugin', () => {
  const demoModule = '/repo/frontend/src/features/auth/dev/DemoAccessPanel.tsx';

  /** Drives the plugin's hooks the way Rollup would, without a real build. */
  function drive(plugin: ReturnType<typeof demoAccessStubPlugin>) {
    const load = plugin.load as (this: unknown, id: string) => string | null;
    const buildStart = plugin.buildStart as (this: unknown) => void;
    return { load: (id: string) => load.call(null, id), start: () => buildStart.call(null) };
  }

  it('records what it replaced, so the scan can tell whether it ran', () => {
    const { load, start } = drive(demoAccessStubPlugin({ stub: true }));

    start();
    expect(stubbedDemoModules()).toEqual([]);

    expect(load(demoModule)).toBe(DEMO_ACCESS_STUBS['DemoAccessPanel.tsx']);
    expect(stubbedDemoModules()).toEqual(['DemoAccessPanel.tsx']);
  });

  it('records nothing when stubbing is off, which is what makes the scan skip', () => {
    // `npm run build:demo` is this case: the demo build deliberately keeps
    // the development sign-in, so the stub must not fire and the scan is
    // disabled alongside it. An enabled scan here would be the false green.
    const { load, start } = drive(demoAccessStubPlugin({ stub: false }));

    start();
    expect(load(demoModule)).toBeNull();
    expect(stubbedDemoModules()).toEqual([]);
  });

  it('resets its record on every build, so a watch rebuild cannot inherit one', () => {
    const { load, start } = drive(demoAccessStubPlugin({ stub: true }));

    start();
    load(demoModule);
    expect(stubbedDemoModules()).toEqual(['DemoAccessPanel.tsx']);

    start();
    expect(stubbedDemoModules()).toEqual([]);
  });

  it('never runs outside a build, and wins the load hook when it does', () => {
    // Both plugins are `apply: 'build'` so the dev server — the one place
    // the demo is meant to work — runs neither, and `enforce: 'pre'` so the
    // stub is read before any transform sees the real file. The stub being
    // silently absent from a build is the regression this file exists for;
    // these are the two properties that decide when it runs at all.
    const stub = demoAccessStubPlugin({ stub: true });
    const scan = demoAccessBoundaryPlugin({ enabled: true });

    expect(stub.apply).toBe('build');
    expect(stub.enforce).toBe('pre');
    expect(scan.apply).toBe('build');
  });

  it('leaves every other module alone', () => {
    const { load, start } = drive(demoAccessStubPlugin({ stub: true }));

    start();
    expect(load('/repo/frontend/src/features/auth/service.ts')).toBeNull();
    expect(load('/repo/frontend/src/app/providers/AuthProvider.tsx')).toBeNull();
    expect(stubbedDemoModules()).toEqual([]);
  });
});

describe('isDemoAccessModule', () => {
  it('matches the dev directory on either platform separator, query strings included', () => {
    expect(isDemoAccessModule('/repo/frontend/src/features/auth/dev/demo-session.ts')).toBe(true);
    expect(isDemoAccessModule('C:\\repo\\frontend\\src\\features\\auth\\dev\\demo-session.ts')).toBe(
      true,
    );
    expect(isDemoAccessModule('/repo/frontend/src/features/auth/dev/DemoAccessPanel.tsx?used')).toBe(
      true,
    );
  });

  it('does not match the real auth modules beside it', () => {
    expect(isDemoAccessModule('/repo/frontend/src/features/auth/service.ts')).toBe(false);
    expect(isDemoAccessModule('/repo/frontend/src/features/auth/mock/users.ts')).toBe(false);
    expect(isDemoAccessModule('/repo/frontend/src/app/providers/AuthProvider.tsx')).toBe(false);
  });
});

describe('findDemoAccessLeaks', () => {
  it('passes a bundle that carries none of the markers', () => {
    expect(
      findDemoAccessLeaks([
        { fileName: 'index-a1b2.js', code: 'const a=1;export{a};' },
        { fileName: 'vendor-c3d4.js', code: 'console.log("doctor@medora.health")' },
      ]),
    ).toEqual([]);
  });

  it('names the chunk and the marker when the affordance leaks', () => {
    const findings = findDemoAccessLeaks([
      { fileName: 'index-a1b2.js', code: 'x("Continue as Demo Doctor")' },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('index-a1b2.js');
    expect(findings[0]).toContain('Continue as Demo Doctor');
  });

  it('catches the caption and the failure copy too, not only the button label', () => {
    // Independent strings of the panel; any one of them shipping is a leak,
    // and a guard that only knew the label would wave the others through.
    expect(
      findDemoAccessLeaks([{ fileName: 'a.js', code: 'p("Local development demo accounts only")' }]),
    ).toHaveLength(1);
    expect(
      findDemoAccessLeaks([
        { fileName: 'b.js', code: 'e("The demo doctor account is not provisioned on this API")' },
      ]),
    ).toHaveLength(1);
  });

  it('reports every marker a single chunk carries, rather than only the first', () => {
    const findings = findDemoAccessLeaks([
      {
        fileName: 'index.js',
        code: '"Continue as Demo Doctor";"Local development demo accounts only";"The demo doctor account is not provisioned on this API"',
      },
    ]);

    expect(findings).toHaveLength(1);
    for (const marker of DEMO_ACCESS_MARKERS) {
      expect(findings[0]).toContain(marker);
    }
  });
});
