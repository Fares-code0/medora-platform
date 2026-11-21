import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The DP-04 seam rule, asserted over the source tree.
 *
 * `docs/handoff/auth-seam.md` §1 rule 3 — *nothing downstream may import an
 * adapter* — is the one seam rule a type cannot hold up: the pre-D-09
 * assistant code typechecked perfectly while reaching straight past its own
 * port. So it is checked by reading the feature's files instead.
 *
 * Promoted here from `features/doctor/ai/service.test.ts` once the messaging,
 * notifications, reports and settings seams needed the same check — five
 * copies of a directory walk and a regex is the duplication §8.2.1's rule of
 * three exists to catch.
 */

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively. */
export function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

/**
 * The files under `featureRoot` that import `adapterModule` (matched on the
 * import specifier's tail, so `./mock/x`, `../mock/x` and `@/features/…/mock/x`
 * all count) while not being the seam itself.
 *
 * Returns paths relative to `featureRoot` so a failure names the offender
 * rather than printing an absolute path from whoever's machine ran it.
 *
 * @param featureRoot Absolute path to the feature directory.
 * @param adapterModule The adapter's module path tail, e.g. `mock/mock-x-service`.
 * @param seamFile The seam module's path relative to `featureRoot`, which is
 *   the one file allowed to import the adapter. Defaults to `service.ts`.
 */
export function adapterImportOffenders(
  featureRoot: string,
  adapterModule: string,
  seamFile = 'service.ts',
): readonly string[] {
  const seamPath = join(featureRoot, seamFile);
  const specifier = new RegExp(
    // Static `import … from '…/<adapterModule>'` and dynamic `import('…')`
    // alike: both are ways downstream code reaches past the seam.
    String.raw`(?:from\s*|import\s*\(\s*)['"][^'"]*` +
      adapterModule.replace(/[/\-.]/g, (char) => `\\${char}`) +
      String.raw`['"]`,
  );

  return sourceFiles(featureRoot)
    .filter((file) => file !== seamPath)
    .filter((file) => specifier.test(readFileSync(file, 'utf8')))
    .map((file) => relative(featureRoot, file).split(sep).join('/'));
}
