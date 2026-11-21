import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postcss, { type AtRule, type Declaration } from 'postcss';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/**
 * DEC-017 — caption size. The dense desktop scale keeps caption at 11px (the
 * Phase 17 decision `tokens.css` records); a coarse pointer gets
 * DESIGN_SYSTEM §3.2's 12px, through the same `(pointer: coarse)` query
 * DEC-008's touch targets use. One token, overridden once: every
 * `text-caption` follows it, so the two sizes cannot drift apart per
 * component. jsdom evaluates no media queries, so the contract is checked at
 * the stylesheet; the rendered size is measured in a browser
 * (FRONTEND_CHECKLIST §19).
 */

function captionDeclarations(): { value: string; media: string | null; selector: string }[] {
  const found: { value: string; media: string | null; selector: string }[] = [];
  postcss.parse(tokensCss).walkDecls('--text-caption', (decl: Declaration) => {
    const rule = decl.parent as { selector?: string; parent?: unknown } | undefined;
    let media: string | null = null;
    let node = rule?.parent as AtRule | { type: string; parent?: unknown } | undefined;
    while (node !== undefined && node.type !== 'root') {
      if (node.type === 'atrule' && (node as AtRule).name === 'media') {
        media = (node as AtRule).params;
        break;
      }
      node = (node as { parent?: AtRule }).parent;
    }
    found.push({ value: decl.value, media, selector: rule?.selector ?? '' });
  });
  return found;
}

describe('caption size (DEC-017)', () => {
  it('is 11px with a fine pointer', () => {
    const base = captionDeclarations().filter((d) => d.media === null);
    expect(base).toEqual([{ value: '0.6875rem', media: null, selector: ':root' }]);
  });

  it('is the design system’s 12px on a coarse pointer, and nowhere else', () => {
    const overrides = captionDeclarations().filter((d) => d.media !== null);
    expect(overrides).toEqual([
      { value: '0.75rem', media: '(pointer: coarse)', selector: ':root' },
    ]);
  });

  it('keeps the caption line height, so a 12px caption does not grow its row', () => {
    const leading: string[] = [];
    postcss.parse(tokensCss).walkDecls('--leading-caption', (decl) => {
      leading.push(decl.value);
    });
    expect(leading).toEqual(['1rem']);
  });
});
