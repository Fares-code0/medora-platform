import 'reflect-metadata';

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppModule } from '../app.module';
import {
  buildOpenApiDocument,
  collectControllers,
  renderDocument,
} from '../openapi/openapi.generator';

/**
 * `npm run openapi:generate` — writes `docs/openapi.json` (RM M33.1).
 *
 * Reads controller metadata from `AppModule`'s module graph; it boots no
 * application, so it needs no database, cache or environment. It runs from
 * the **build** (`node dist/cli/openapi-generate.js`) like the other CLIs,
 * because the decorator metadata it reads is what `tsc` emits.
 *
 * `--check` compares instead of writing and exits 1 on drift.
 */
const root = resolve(__dirname, '..', '..');
const target = resolve(root, 'docs', 'openapi.json');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

const rendered = renderDocument(
  buildOpenApiDocument(collectControllers(AppModule), { version: pkg.version }),
);

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== rendered) {
    console.error('docs/openapi.json is out of date — run `npm run openapi:generate`.');
    process.exit(1);
  }
  console.log('docs/openapi.json is up to date.');
} else {
  writeFileSync(target, rendered);
  console.log(`Wrote ${target}`);
}
