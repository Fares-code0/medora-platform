import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The RTL ratchet (F-19).
 *
 * Arabic and Persian are shipped, and the thing that keeps them working is
 * not this test — it is that every spacing, alignment, border, radius and
 * inset in `src/` is written as a **logical** property, so `dir="rtl"` on
 * `<html>` mirrors the whole app for free. A single `ml-4` added later does
 * not fail anything, does not look wrong in English, and quietly breaks one
 * corner of two languages nobody on the team reads.
 *
 * So: physical direction utilities are banned, and this is what enforces it.
 * It scans source rather than rendered output on purpose — a rendered check
 * only sees the components a test happened to mount.
 *
 * | Instead of        | Write            |
 * | ----------------- | ---------------- |
 * | `ml-`, `mr-`      | `ms-`, `me-`     |
 * | `pl-`, `pr-`      | `ps-`, `pe-`     |
 * | `left-`, `right-` | `start-`, `end-` |
 * | `text-left/right` | `text-start/end` |
 * | `border-l/r`      | `border-s/e`     |
 * | `rounded-l/r`     | `rounded-s/e`    |
 *
 * The genuine exceptions are `rtl:` and `ltr:` variants — an explicit,
 * reviewed statement that this one thing does *not* mirror on its own
 * (a `translate-x`, a gradient direction) — and they are allowed through.
 */

const SRC = join(process.cwd(), 'src');

/** Utilities whose meaning is a physical side rather than a reading side. */
const BANNED = [
  /(?<![\w-])(?:ml|mr|pl|pr)-(?:\d|auto|px|\[)/,
  /(?<![\w-])(?:left|right)-(?:\d|auto|full|px|\[)/,
  /(?<![\w-])text-(?:left|right)(?![\w-])/,
  /(?<![\w-])border-[lr](?![\w-])/,
  /(?<![\w-])rounded-[lr](?:-|(?![\w-]))/,
];

/**
 * The whole-tree scan below reads and walks every file in `src/` (~1 s when
 * run alone). Under a full-suite run it shares the CPU with every other
 * worker and overran Vitest's 5 s default — a load flake, not a slow check.
 * 30 s gives it room without hiding a genuine hang; no assertion changes.
 */
const WHOLE_TREE_SCAN_TIMEOUT_MS = 30_000;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts|css)$/.test(entry) && !entry.endsWith('.d.ts') ? [full] : [];
  });
}

describe('layout is written in logical properties', () => {
  it(
    'uses no physical direction utility anywhere in src/',
    () => {
      // Vitest's root is `frontend/`; a wrong root throws here rather than
      // scanning nothing and passing.
      const offenders: string[] = [];

      for (const file of sourceFiles(SRC)) {
        // This file quotes every banned pattern in its own table.
        if (file.endsWith('logical-properties.test.ts')) continue;

        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          // An explicit `rtl:`/`ltr:` variant is the sanctioned exception.
          if (/(?:^|[\s"'`:])(?:rtl|ltr):/.test(line)) return;
          if (BANNED.some((pattern) => pattern.test(line))) {
            offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${String(index + 1)}`);
          }
        });
      }

      expect(offenders).toEqual([]);
    },
    WHOLE_TREE_SCAN_TIMEOUT_MS,
  );

  it('finds files to scan at all', () => {
    // Guards the guard: a broken walker would report zero offenders forever.
    expect(sourceFiles(SRC).length).toBeGreaterThan(300);
  });
});
