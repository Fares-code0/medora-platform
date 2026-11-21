import { describe, expect, it } from 'vitest';

import tailwindConfig from '../../tailwind.config';

import { cn, DS_FONT_SIZES } from './cn';

/**
 * `cn` has to know the DS type scale, because `text-*` is two utilities under
 * one prefix — a font size and a text colour — and tailwind-merge separates
 * them by matching against Tailwind's STOCK scale, which this project
 * replaced wholesale. Left unconfigured it filed `text-body-sm` and
 * `text-text-inverse` in the same group and kept only the last one written,
 * silently deleting either the colour or the size from every class list that
 * carried both. Every Button in the app lost its variant colour that way.
 *
 * These are regression guards for a bug with no symptom at the type level:
 * the output is a well-formed class list, just one entry short.
 */

describe('cn — the font-size/text-colour seam', () => {
  it.each([
    ['a primary button', 'bg-primary text-text-inverse h-8 px-3 text-body-sm'],
    ['a secondary button', 'bg-surface text-primary h-8 px-3 text-body-sm'],
    ['a destructive button', 'bg-error text-text-inverse h-8 px-3 text-body-sm'],
    ['a badge (colour last)', 'text-caption font-medium bg-success-subtle text-success'],
    ['a heading (colour last)', 'text-h5 font-semibold text-text-primary'],
    ['a caption (size last)', 'text-text-secondary mt-0.5 text-caption'],
  ])('keeps both the size and the colour on %s', (_name, classes) => {
    const out = cn(classes).split(' ');
    const dropped = classes.split(' ').filter((c) => !out.includes(c));

    expect(dropped, `cn() deleted ${dropped.join(', ')}`).toEqual([]);
  });

  it('still resolves a genuine size conflict, last one winning', () => {
    expect(cn('text-h5 text-body')).toBe('text-body');
    expect(cn('text-body-sm', 'text-h1')).toBe('text-h1');
  });

  it('still resolves a genuine colour conflict, last one winning', () => {
    expect(cn('text-primary text-error')).toBe('text-error');
    expect(cn('text-text-inverse', 'text-text-disabled')).toBe('text-text-disabled');
  });

  /**
   * The list in `cn.ts` is a hand-kept copy of the Tailwind theme's fontSize
   * keys. A step added to the theme and not to `cn` is not a type error and
   * not a visual one either — it just starts silently deleting colours again
   * wherever that step is used, which is precisely how this bug arrived.
   */
  it('names exactly the type scale the Tailwind theme defines', () => {
    const themeSizes = Object.keys(tailwindConfig.theme?.extend?.fontSize ?? {});

    expect([...DS_FONT_SIZES].sort()).toEqual(themeSizes.sort());
  });
});
