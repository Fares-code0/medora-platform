import type { Plugin } from 'vite';

/**
 * The demo-access boundary — two plugins: one that removes the development
 * sign-in from a production build, and one that proves it is gone.
 *
 * `features/auth/dev/` holds a development sign-in: a button on the login
 * page that signs in as the seeded demo doctor. It once minted a fixture
 * session on the client; it now calls the real `login` with local-only
 * demo credentials, which are no more welcome in a production bundle.
 *
 * ## Why source-level guards are not enough
 *
 * Every call site sits behind `import.meta.env.DEV`, and the first version
 * of this file trusted that alone: Vite substitutes `false`, Rollup drops
 * the branch, the modules tree-shake away. That reasoning has two holes,
 * and a Vercel deployment found them both.
 *
 *  1. **`import.meta.env.DEV` is not a constant of the build — it is
 *     derived from `NODE_ENV`.** Vite computes `isProduction` from the
 *     ambient `NODE_ENV`, so a host that exports `NODE_ENV=development`
 *     around the build gets `import.meta.env.DEV === true` out of a plain
 *     `vite build`. The flag we reached for precisely because it "cannot be
 *     configured" turns out to be configured by the platform.
 *  2. **Tree shaking is an optimization, not a guarantee.** Even with the
 *     branch correctly eliminated, Rollup retained the button's string
 *     literal in the entry chunk on the deployment host while dropping it
 *     locally, on the same commit and the same versions of vite, rollup and
 *     esbuild. Whatever the cause, "it did not survive on my machine" is
 *     evidently not a property anyone can rely on.
 *
 * So the boundary is no longer a hope about what the optimizer will do.
 * `demoAccessStubPlugin` *replaces the source of those modules* with inert
 * stubs before Rollup ever sees them, which makes the leak impossible
 * rather than unlikely — the strings are not in the input, so no amount of
 * tree-shaking behaviour can put them in the output.
 *
 * `demoAccessBoundaryPlugin` then checks the emitted bundle and fails the
 * build if anything got through anyway. Belt and braces, deliberately: the stub is
 * the mechanism and the scan is the proof, and neither is asked to be both.
 *
 * Both key off the build **mode**, not `NODE_ENV`. `vite build` is mode
 * `production` unless someone passes `--mode` to say otherwise, and no
 * environment variable changes it.
 *
 * ## Why the scan checks that the stub ran
 *
 * Because a green scan used to prove nothing about the stub. Tree shaking
 * removes these strings whether or not the stub fired, so on any machine
 * where the stub silently did not run — a renamed file, a missing
 * `DEMO_ACCESS_STUBS` entry, a plugin dropped from the config — the scan
 * still passed and the mechanism's failure went unnoticed. That is how the
 * same leak reached a deployment twice.
 *
 * So the stub now records what it replaced, and an enabled scan fails the
 * build when that record is short. The scan no longer claims merely that
 * nothing leaked; it names the modules it stubbed, so a build that removed
 * nothing cannot look like a build that removed everything.
 *
 * ## Why it scans text rather than the module graph
 *
 * The markers are *string literals* — a button label and the panel's own
 * copy — and a minifier does not rewrite the contents of a string.
 * If any of them is in the emitted code, that code shipped. There is no
 * false positive available, and a graph check would additionally miss the
 * case that matters most: a fixture value inlined by constant folding
 * after its module was shaken out.
 */

/**
 * Strings that exist nowhere but the development sign-in.
 *
 * Each is deliberately distinctive enough that it cannot occur by
 * coincidence: the affordance, its caption and its failure message.
 * Finding any one of them in a production bundle means the panel shipped.
 * The demo credentials themselves are not markers — the same address and
 * password are the mock roster's, which a production bundle may carry.
 *
 * If you rename something in `features/auth/dev/`, rename it here too —
 * `demo-access-boundary.test.ts` asserts the markers still match the
 * source, so a rename that orphans this list fails the suite rather than
 * quietly disarming the guard.
 */
export const DEMO_ACCESS_MARKERS: readonly string[] = [
  'Continue as Demo Doctor',
  'Local development demo accounts only',
  'The demo doctor account is not provisioned on this API',
];

/** Marks a module under `features/auth/dev/`, whatever the platform separators. */
export function isDemoAccessModule(id: string): boolean {
  const path = id.replace(/\\/g, '/').split('?')[0] ?? '';
  return path.includes('/src/features/auth/dev/');
}

/**
 * The inert replacements a production build compiles instead.
 *
 * Keyed by file name so a stub is matched to the module it stands in for.
 * The export lists must stay in step with the real modules — Rollup fails
 * loudly on a missing export, and `demo-access-boundary.test.ts` fails
 * earlier and more legibly, in CI rather than at deploy time.
 *
 * The panel's stub renders nothing, and carries neither the demo
 * credentials nor any of the markers.
 */
export const DEMO_ACCESS_STUBS: Readonly<Record<string, string>> = {
  'DemoAccessPanel.tsx': `/* Development demo access is stripped from production builds.
   See scripts/demo-access-boundary.ts. */
export function DemoAccessPanel() {
  return null;
}
`,
};

/**
 * What the stub plugin replaced, for the scan to check afterwards.
 *
 * Module-level rather than passed between the two plugins, because they
 * are separate objects in the `plugins` array and this keeps their
 * coupling to one exported name. Reset on every `buildStart` so a watch
 * rebuild does not inherit the previous run's answer.
 */
const stubbedModules = new Set<string>();

/** File names this build compiled a stub for. Read by the scan. */
export function stubbedDemoModules(): readonly string[] {
  return [...stubbedModules].sort();
}

/**
 * Compiles the inert stubs in place of `features/auth/dev/` when building
 * for production. `enforce: 'pre'` so it wins the `load` hook before any
 * transform reads the real file.
 *
 * Records what it replaced. That record is what lets the scan tell a build
 * where the stub ran from one where it never fired — see
 * `demoAccessBoundaryPlugin`.
 */
export function demoAccessStubPlugin(options: { readonly stub: boolean }): Plugin {
  return {
    name: 'medora:demo-access-stub',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      stubbedModules.clear();
    },
    load(id) {
      if (!options.stub || !isDemoAccessModule(id)) return null;
      const fileName = (id.replace(/\\/g, '/').split('?')[0] ?? '').split('/').pop() ?? '';
      const stub = DEMO_ACCESS_STUBS[fileName];
      if (stub === undefined) return null;
      stubbedModules.add(fileName);
      return stub;
    },
  };
}

/** A bundle chunk reduced to what the scan needs. */
export interface EmittedChunk {
  readonly fileName: string;
  readonly code: string;
}

/**
 * The markers each chunk carries.
 *
 * Returns findings rather than throwing, so the caller decides what a
 * violation costs — the plugin fails the build, the tests merely read them.
 */
export function findDemoAccessLeaks(chunks: readonly EmittedChunk[]): string[] {
  const findings: string[] = [];
  for (const chunk of chunks) {
    const found = DEMO_ACCESS_MARKERS.filter((marker) => chunk.code.includes(marker));
    if (found.length > 0) {
      findings.push(`${chunk.fileName} carries ${found.map((m) => `"${m}"`).join(', ')}`);
    }
  }
  return findings.sort();
}

/**
 * Verifies the emitted bundle. Reads the code in `generateBundle`.
 *
 * `enabled` is false for a deliberate non-production build (`vite build
 * --mode development`), where this code is *supposed* to be present and a
 * failure would be the guard rejecting the correct answer.
 */
export function demoAccessBoundaryPlugin(options: { readonly enabled: boolean }): Plugin {
  return {
    name: 'medora:demo-access-boundary',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (!options.enabled) {
        console.log('· Demo-access boundary: skipped — this is not a production build');
        return;
      }

      /*
       * First: did the mechanism actually run? This is the check whose
       * absence let the same leak reach a deployment twice. Tree shaking
       * removes these strings whether or not the stub fired, so a passing
       * scan on its own proves nothing about the stub — and "it did not
       * survive on my machine" is exactly what differed between machines.
       *
       * A scan that is enabled while the stub did not replace every module
       * is the false green this guards against: the real modules were
       * compiled, and only the optimizer stood between them and the
       * bundle. Fail instead of reporting success.
       */
      const stubbed = stubbedDemoModules();
      const expected = Object.keys(DEMO_ACCESS_STUBS).sort();
      if (stubbed.length !== expected.length) {
        this.error(
          '\n✖ The demo-access stub did not run for this build.\n\n' +
            `  stubbed:  ${stubbed.length === 0 ? '(nothing)' : stubbed.join(', ')}\n` +
            `  expected: ${expected.join(', ')}\n\n` +
            'demoAccessStubPlugin is what removes the development sign-in from a\n' +
            'build. If it did not replace every module under\n' +
            'src/features/auth/dev/, the real ones were compiled instead, and\n' +
            'whether their strings survive is left to tree shaking — which is\n' +
            'exactly the thing that differs between machines.\n\n' +
            'Check that demoAccessStubPlugin({ stub: true }) is registered in\n' +
            'vite.config.ts for this build, and that every file in that\n' +
            'directory has an entry in DEMO_ACCESS_STUBS.\n',
        );
        return;
      }

      const chunks: EmittedChunk[] = Object.values(bundle)
        .filter((output): output is Extract<typeof output, { type: 'chunk' }> => {
          return output.type === 'chunk';
        })
        .map((chunk) => ({ fileName: chunk.fileName, code: chunk.code }));

      const findings = findDemoAccessLeaks(chunks);

      if (findings.length > 0) {
        this.error(
          '\n✖ Development demo access reached the production bundle:\n\n' +
            findings.map((finding) => `  ${finding}`).join('\n') +
            '\n\nA production build compiles inert stubs in place of\n' +
            'src/features/auth/dev/ (demoAccessStubPlugin), so these strings should\n' +
            'not exist in the input at all. Either a module moved out of that\n' +
            'directory, or one of the marked strings is now duplicated somewhere\n' +
            'that is not stubbed. A production build must not contain a way to\n' +
            'obtain a session without the real backend.\n',
        );
        return;
      }

      console.log(
        `✓ Demo-access boundary: stubbed ${stubbed.join(', ')}; ` +
          'no development sign-in in the production bundle',
      );
    },
  };
}
