import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The M2.2 verification, kept rather than thrown away.
 *
 * The roadmap's verify step is "a demonstrative illegal cross-module
 * import fails lint (test committed, then removed)". Removing it leaves
 * the rule unguarded, and this rule has a quiet failure mode:
 * `import/no-restricted-paths` skips any import it cannot resolve, so a
 * broken resolver — a renamed tsconfig, a dropped dependency — turns
 * every zone into a no-op without a single lint error to show for it.
 *
 * So the fixtures stay on disk in `__boundary-fixtures__/` folders,
 * `eslint .` ignores them, and this spec lints them on purpose with
 * `ignore: false` and asserts what each one does.
 */

/** Path (relative to `backend/`) → the zone message it must be rejected by. */
const MUST_FAIL: ReadonlyArray<readonly [string, RegExp]> = [
  ['src/modules/labs/__boundary-fixtures__/illegal-sibling.ts', /Modules are isolated/],
  ['src/modules/labs/__boundary-fixtures__/illegal-sibling-alias.ts', /Modules are isolated/],
  [
    'src/modules/labs/__boundary-fixtures__/illegal-shared-internal.ts',
    /Import the shared kernel through its index/,
  ],
  [
    'src/modules/labs/__boundary-fixtures__/illegal-authz-internal.ts',
    /Import the shared kernel through its index/,
  ],
  [
    'src/shared/__boundary-fixtures__/illegal-kernel-to-module.ts',
    /must not depend on a domain module/,
  ],
  ['src/common/__boundary-fixtures__/illegal-common-to-shared.ts', /common\/ is the lowest layer/],
  [
    'src/modules/labs/__boundary-fixtures__/illegal-config-internal.ts',
    /Import configuration through its index/,
  ],
  [
    'src/config/__boundary-fixtures__/illegal-config-to-module.ts',
    /config\/ must not depend on a domain module/,
  ],
];

const MUST_PASS = 'src/modules/labs/__boundary-fixtures__/legal.ts';

const BOUNDARY_RULE = 'import/no-restricted-paths';

describe('module boundaries (RM M2.2)', () => {
  let byFile: Map<string, ESLint.LintResult>;

  beforeAll(async () => {
    // `ignore: false` is what reaches the fixtures — the flat config
    // ignores them so the normal gate stays green. Everything else is
    // the real project config, deliberately: a spec that rebuilt the
    // zones inline would assert its own copy of the rules, not the ones
    // CI runs.
    const eslint = new ESLint({ ignore: false });
    const results = await eslint.lintFiles(['src/**/__boundary-fixtures__/*.ts']);

    byFile = new Map(
      results.map((result) => [result.filePath.replaceAll('\\', '/'), result] as const),
    );
  }, 60_000);

  const find = (relativePath: string): ESLint.LintResult => {
    for (const [filePath, result] of byFile) {
      if (filePath.endsWith(relativePath)) return result;
    }
    throw new Error(`Boundary fixture not linted: ${relativePath}`);
  };

  it.each(MUST_FAIL)('rejects %s', (relativePath, expectedMessage) => {
    const result = find(relativePath);
    const violations = result.messages.filter((message) => message.ruleId === BOUNDARY_RULE);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(expectedMessage);
    expect(violations[0]?.severity).toBe(2);
  });

  it('permits common/ and the shared kernel indexes', () => {
    expect(find(MUST_PASS).messages).toEqual([]);
  });

  it('lints every fixture on disk, so a renamed file cannot go unchecked', () => {
    expect(byFile.size).toBe(MUST_FAIL.length + 1);
  });
});
