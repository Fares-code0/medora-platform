import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import tailwindConfig from '../../tailwind.config';

/**
 * Guards the seam between the class names source writes and the tokens
 * `tailwind.config.ts` actually defines.
 *
 * Tailwind fails silently here: an unknown token name produces no rule at all,
 * so nothing in typecheck, lint or the test suite notices. Two live bugs came
 * from exactly that — `ring-focus` (the token is `focus-ring`, so the controls
 * fell back to preflight's default blue) and `bg-primary/20|40|60|80` (the DS
 * tokens held whole colours, so every opacity modifier was dropped and the
 * heatmap intensity ramp collapsed).
 *
 * Rather than re-implementing Tailwind's naming rules, this compiles the
 * candidates through Tailwind itself and asserts each one produced CSS.
 */

/** Utility prefixes that resolve against the theme's colour scale. */
const COLOUR_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'ring-offset',
  'divide',
  'outline',
  'fill',
  'stroke',
  'shadow',
  'accent',
  'caret',
  'decoration',
  'placeholder',
  'from',
  'via',
  'to',
] as const;

const CANDIDATE = new RegExp(
  // optional variants (`hover:`, `focus-visible:`, `dark:`), then a colour
  // utility and its token name, optionally with an `/opacity` modifier
  `^(?:[a-z][a-z0-9-]*:)*(?:${COLOUR_PREFIXES.join('|')})-[a-z][a-z0-9-]*(?:/\\d+)?$`,
);

/**
 * Prose can collide with the candidate shape — "Sender ID and text-message
 * delivery." yields `text-message`. Class lists are all-lowercase utility
 * words, so a literal holding a capitalised word or sentence punctuation is
 * read as prose and skipped.
 */
const CLASS_WORD = /^-?[a-z0-9][a-z0-9:_/.[\]%(),#=-]*$/;

function isClassList(literal: string): boolean {
  const words = literal.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => CLASS_WORD.test(word));
}

const sources: Record<string, string> = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Strips leading variants so `focus-visible:ring-focus` tests as `ring-focus`. */
function baseUtility(candidate: string): string {
  const parts = candidate.split(':');
  return parts[parts.length - 1] ?? candidate;
}

/** Every colour-utility class name written anywhere in src, by file. */
const usages = new Map<string, Set<string>>();
for (const [file, code] of Object.entries(sources)) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
  for (const match of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n$]*)`/g)) {
    // One alternative per quote style, so take whichever group actually matched.
    const literal = match[1] ?? match[2] ?? match[3];
    if (literal === undefined || !isClassList(literal)) continue;
    for (const word of literal.split(/\s+/)) {
      if (!CANDIDATE.test(word)) continue;
      const base = baseUtility(word);
      const seen = usages.get(base) ?? new Set<string>();
      seen.add(file);
      usages.set(base, seen);
    }
  }
}

/** Class names Tailwind emitted a rule for, unescaped back to source form. */
async function compile(classNames: readonly string[]): Promise<Set<string>> {
  const css = await postcss([
    tailwindcss({
      ...tailwindConfig,
      content: [{ raw: classNames.join(' '), extension: 'html' }],
    }),
  ]).process('@tailwind utilities;', { from: undefined });

  const emitted = new Set<string>();
  css.root.walkRules((rule) => {
    for (const [, escaped] of rule.selector.matchAll(/\.((?:[^\s.:,>+~[\]()]|\\.)+)/g)) {
      if (escaped !== undefined) emitted.add(escaped.replace(/\\/g, ''));
    }
  });
  return emitted;
}

describe('theme utilities', () => {
  it('finds colour utilities to check', () => {
    // The check below passes vacuously if extraction breaks, and it broke once
    // already — an early version read only single-quoted literals and silently
    // skipped every double-quoted JSX className. src currently yields ~141
    // distinct utilities, so a drop past this floor means the scanner regressed
    // rather than that the styles did.
    expect(usages.size).toBeGreaterThan(120);
  });

  it('names only tokens the Tailwind theme defines', async () => {
    const candidates = [...usages.keys()].sort();
    const emitted = await compile(candidates);

    const unresolved = candidates
      .filter((name) => !emitted.has(name))
      .map((name) => `${name} — used in ${[...(usages.get(name) ?? [])].sort().join(', ')}`);

    expect(
      unresolved,
      'these classes name a token tailwind.config.ts does not define, so Tailwind emits no CSS for them',
    ).toEqual([]);
  });
});
