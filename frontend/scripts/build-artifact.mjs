#!/usr/bin/env node
/**
 * Packages the Medora client as the one HTML file the Artifact host wants.
 *
 * Runs `vite.artifact.config.ts` (see the rationale there), then folds the two
 * emitted assets back into the page:
 *
 *   dist-artifact/index.html          the shell, plus the no-flash theme boot
 *   dist-artifact/assets/*.css        Tailwind's output with the fonts already
 *                                     inlined as data URIs
 *   dist-artifact/assets/*.js         one entry chunk — every route inlined
 *
 * The host wraps what it is given in `<!doctype html><head>…</head><body>`, so
 * the output is body-level content only: no doctype, html, head or body tags of
 * our own. Everything else about the page is the real application — this is a
 * packaging step, not a second implementation of it.
 *
 *   node scripts/build-artifact.mjs [--out <path>] [--skip-build]
 *
 * Writes dist-artifact/medora-artifact.html unless --out says otherwise.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(frontendRoot, 'dist-artifact');

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outFile = outFlag === -1 ? join(outDir, 'medora-artifact.html') : resolve(args[outFlag + 1]);

if (!args.includes('--skip-build')) {
  execFileSync('npx', ['vite', 'build', '--config', 'vite.artifact.config.ts'], {
    cwd: frontendRoot,
    stdio: 'inherit',
  });
}

const assets = readdirSync(join(outDir, 'assets'));
const only = (ext) => {
  const matches = assets.filter((name) => name.endsWith(ext));
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one ${ext} asset in dist-artifact/assets, found ${matches.length}: ` +
        `${matches.join(', ') || '(none)'}. The artifact build must not code-split.`,
    );
  }
  return readFileSync(join(outDir, 'assets', matches[0]), 'utf8');
};

const css = only('.css');
const js = only('.js');

// `</script>` anywhere in the bundle's own string literals would close the tag
// we are about to wrap it in. Escaping the slash is inert inside JS and invisible
// to the HTML parser.
const escaped = js.replaceAll('</script', '<\\/script');

const html = readFileSync(join(outDir, 'index.html'), 'utf8');

// The no-flash theme boot is authored in index.html and has to keep running
// before first paint, so it is lifted verbatim rather than reproduced here.
const themeBoot = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (themeBoot === undefined) {
  throw new Error('no inline boot script found in dist-artifact/index.html');
}

// Any remaining reference to a sibling file would 404 on the host: the page is
// published alone. Catch it here rather than in the browser.
const leftovers = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((url) => !url.startsWith('data:') && !url.startsWith('http'));
const unresolved = leftovers.filter((url) => !assets.some((name) => url.endsWith(name)));
if (unresolved.length > 0) {
  throw new Error(`dist-artifact/index.html still references ${unresolved.join(', ')}`);
}

writeFileSync(
  outFile,
  [
    '<title>Medora</title>',
    `<style>\n${css}\n</style>`,
    `<script>${themeBoot}</script>`,
    '<div id="root"></div>',
    `<script type="module">\n${escaped}\n</script>`,
    '',
  ].join('\n'),
  'utf8',
);

const mb = (readFileSync(outFile).byteLength / 1024 / 1024).toFixed(2);
console.log(`wrote ${outFile} (${mb} MB)`);
