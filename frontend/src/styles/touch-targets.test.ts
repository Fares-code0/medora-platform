import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postcss, { type AtRule, type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import tailwindConfig from '../../tailwind.config';

const globalsCss = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

/**
 * The touch-target layer (DEC-008) is CSS a DOM test cannot evaluate — jsdom
 * runs no media queries — so this guards its two promises at the stylesheet:
 *
 * 1. Nothing of it reaches a fine pointer. Every `.touch-target` rule and
 *    every `touch:` utility lives inside `@media (pointer: coarse)`; desktop
 *    renders exactly as before.
 * 2. The hidden hit area never exceeds the reserved space. The pseudo-element
 *    is inset by the negative of the same variables the margin uses, so the
 *    hit area IS the margin box, and margin boxes do not overlap.
 *
 * Whether real layouts then overlap is measured in a browser (FRONTEND_CHECKLIST
 * §14.1 DEC-008), not here.
 */

const COARSE = '(pointer: coarse)';

function mediaOf(node: Rule): AtRule | null {
  let parent = node.parent;
  while (parent !== undefined && parent.type !== 'root') {
    if (parent.type === 'atrule' && parent.name === 'media') return parent;
    parent = parent.parent;
  }
  return null;
}

describe('.touch-target in globals.css', () => {
  const rules: Rule[] = [];
  postcss.parse(globalsCss).walkRules((rule) => {
    if (rule.selector.includes('.touch-target')) rules.push(rule);
  });

  it('exists, and applies only on a coarse pointer', () => {
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const rule of rules) {
      expect(mediaOf(rule)?.params).toBe(COARSE);
    }
  });

  it('reserves the gutter as margin and fills exactly that box with the hit area', () => {
    const box = rules.find((rule) => !rule.selector.includes('::after'));
    const area = rules.find((rule) => rule.selector.includes('::after'));
    const decl = (rule: Rule | undefined, prop: string) =>
      rule?.nodes.find((node) => node.type === 'decl' && node.prop === prop)?.toString();

    expect(decl(box, 'margin')).toBe('margin: var(--touch-y, 0px) var(--touch-x, 0px)');
    expect(decl(area, 'inset')).toBe(
      'inset: calc(var(--touch-y, 0px) * -1) calc(var(--touch-x, 0px) * -1)',
    );
  });

  it('leaves a control laid over another surface alone', () => {
    for (const rule of rules) {
      expect(rule.selector).toContain(':not(.absolute):not(.fixed)');
    }
  });
});

describe('the touch: variant', () => {
  it('compiles to a coarse-pointer media query, never to a viewport width', async () => {
    const candidates = ['touch:min-h-[44px]', 'touch:h-11', 'touch:min-w-[44px]', 'touch:mt-[13px]'];
    const result = await postcss([
      tailwindcss({
        ...tailwindConfig,
        content: [{ raw: candidates.join(' '), extension: 'html' }],
      }),
    ]).process('@tailwind utilities;', { from: undefined });

    const found: string[] = [];
    result.root.walkRules((rule) => {
      if (rule.selector.startsWith('.touch\\:')) {
        expect(mediaOf(rule)?.params).toBe(COARSE);
        found.push(rule.selector);
      }
    });
    expect(found).toHaveLength(candidates.length);
  });
});
