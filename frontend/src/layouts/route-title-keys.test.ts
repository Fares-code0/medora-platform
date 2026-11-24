import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isMessageKey } from '@/i18n';

/**
 * Every route's `handle.titleKey` names a real catalogue key.
 *
 * `RouteHandle.titleKey` is typed `string` (a platform layer may not depend on
 * the key union), so a typo compiles — and then shows the raw key in the tab
 * title, the route announcer and the breadcrumb. This reads every route
 * declaration in `src/` — `titleKey: '…'` literals and the admin area's
 * `section(slug, key, …)` / `liveSection(slug, key, …)` helpers — and checks
 * each key against the English catalogue.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.(test|stories)\.tsx?$/.test(entry) ? [full] : [];
  });
}

const DECLARATIONS = [
  /titleKey: '([^']+)'/g,
  /\b(?:section|liveSection)\('[\w-]+', '([^']+)'/g,
];

function routeTitleKeys(): { readonly at: string; readonly key: string }[] {
  return sourceFiles(SRC).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return DECLARATIONS.flatMap((pattern) =>
      [...source.matchAll(pattern)].map((match) => ({
        at: relative(SRC, file).replace(/\\/g, '/'),
        key: match[1] ?? '',
      })),
    );
  });
}

describe('route title keys', () => {
  it(
    'are all keys of the English catalogue',
    () => {
      const keys = routeTitleKeys();
      // Guards the guard: doctor, admin, reception and auth routes together
      // declare well over thirty names.
      expect(keys.length).toBeGreaterThan(30);
      const unknown = keys.filter(({ key }) => !isMessageKey(key));
      expect(unknown).toEqual([]);
    },
    60_000,
  );
});
