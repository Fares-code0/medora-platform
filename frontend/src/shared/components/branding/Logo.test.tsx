import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo } from './Logo';
import {
  MEDORA_CROSSING,
  MEDORA_GLYPHS,
  MEDORA_LOCKUP_VIEWBOX,
  MEDORA_MARK_CENTERLINES,
  MEDORA_MARK_VIEWBOX,
} from './medoraLogoPaths';

/**
 * The logo, and the geometry it is drawn from.
 *
 * The geometry half is the part worth having: `medoraLogoPaths.ts` is
 * generated data, and the failure mode of a bad regeneration is silent —
 * a path whose coordinates fall outside the viewBox renders as a cropped
 * wordmark, not as an error, and it renders that way in every placement at
 * once. These assertions are what a re-vectorisation has to survive.
 */

/** viewBox strings are `min-x min-y width height`. */
function viewBoxOf(value: string) {
  const parts = value.split(' ').map(Number);
  expect(parts, `"${value}" is not four numbers`).toHaveLength(4);
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  return { x, y, width, height, right: x + width, bottom: y + height };
}

/**
 * Every path in the artwork is `M` followed by implicit lineto pairs, so the
 * numbers are coordinates in reading order — x, y, x, y. jsdom has no
 * `getBBox`, and this needs no renderer anyway.
 */
function extent(d: string) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  expect(nums.length % 2, `${nums.length} coordinates is not a whole number of pairs`).toBe(0);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function paths(container: HTMLElement) {
  return [...container.querySelectorAll('path')];
}

describe('logo geometry', () => {
  const lockup = viewBoxOf(MEDORA_LOCKUP_VIEWBOX);

  it.each(Object.entries(MEDORA_GLYPHS))('keeps the %s glyph inside the lockup', (_name, d) => {
    const box = extent(d);
    expect(box.minX).toBeGreaterThanOrEqual(lockup.x);
    expect(box.maxX).toBeLessThanOrEqual(lockup.right);
    expect(box.minY).toBeGreaterThanOrEqual(lockup.y);
    expect(box.maxY).toBeLessThanOrEqual(lockup.bottom);
  });

  it('frames the ligature evenly in the mark viewBox, and tighter than the lockup', () => {
    const mark = viewBoxOf(MEDORA_MARK_VIEWBOX);
    const box = extent(MEDORA_GLYPHS.ligature);
    const insets = [
      box.minX - mark.x,
      mark.right - box.maxX,
      box.minY - mark.y,
      mark.bottom - box.maxY,
    ];

    // Every inset positive (the ligature is inside its box) and even to within
    // a unit, so it sits centred rather than drifting to one side.
    for (const inset of insets) expect(inset).toBeGreaterThan(0);
    expect(Math.max(...insets) - Math.min(...insets)).toBeLessThanOrEqual(1);

    // Tighter than the lockup's crop on purpose: standing alone the mark fills
    // its box, so `variant="mark"` draws slightly larger than the same ligature
    // inside the word at the same `size`.
    expect(Math.max(...insets)).toBeLessThan(box.minY - lockup.y);
  });

  it('starts both ribbons at the crossing so they grow outward together', () => {
    const start = (d: string) => {
      const [x = NaN, y = NaN] = d.slice(1).trim().split(/\s+/).slice(0, 2).map(Number);
      return { x, y };
    };

    expect(start(MEDORA_MARK_CENTERLINES.left)).toEqual(MEDORA_CROSSING);
    expect(start(MEDORA_MARK_CENTERLINES.right)).toEqual(MEDORA_CROSSING);
    // The ascender is the exception: it runs downward, into the loop.
    expect(start(MEDORA_MARK_CENTERLINES.stem)).not.toEqual(MEDORA_CROSSING);
  });

  it('anchors the entrance transform-origin on the crossing', () => {
    // MedoraIntro.css scales the lockup out of the crossing point, written as
    // percentages of the viewBox because CSS cannot read the constant. Nothing
    // else ties the two together, and the failure is a logo that grows out of
    // the wrong place — subtle enough to ship.
    // Read from disk, not imported: Vitest stubs CSS modules to an empty
    // string, so `?raw` comes back blank and the check would pass vacuously.
    const css = readFileSync(
      join(process.cwd(), 'src/shared/components/branding/MedoraIntro.css'),
      'utf8',
    );

    const origin = /transform-origin:\s*([\d.]+)%\s+([\d.]+)%/.exec(css);
    expect(origin, 'no transform-origin in MedoraIntro.css').not.toBeNull();

    const percent = (value: number, min: number, span: number) =>
      Number((((value - min) / span) * 100).toFixed(1));

    expect(Number(origin?.[1])).toBe(percent(MEDORA_CROSSING.x, lockup.x, lockup.width));
    expect(Number(origin?.[2])).toBe(percent(MEDORA_CROSSING.y, lockup.y, lockup.height));
  });
});

describe('<Logo />', () => {
  it('draws the full wordmark by default', () => {
    const { container } = render(<Logo />);

    expect(paths(container).map((p) => p.getAttribute('d'))).toEqual([
      MEDORA_GLYPHS.M,
      MEDORA_GLYPHS.e,
      MEDORA_GLYPHS.ligature,
      MEDORA_GLYPHS.r,
      MEDORA_GLYPHS.a,
    ]);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', MEDORA_LOCKUP_VIEWBOX);
  });

  it('draws the ligature alone as the mark', () => {
    const { container } = render(<Logo variant="mark" />);

    expect(paths(container).map((p) => p.getAttribute('d'))).toEqual([MEDORA_GLYPHS.ligature]);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', MEDORA_MARK_VIEWBOX);
  });

  it('sizes width from the variant, so neither shape is stretched', () => {
    const { container: lockup } = render(<Logo size="lg" />);
    const { container: mark } = render(<Logo size="lg" variant="mark" />);

    // Both are 34px tall; only the width differs, by each viewBox's own ratio
    // (1722÷411 and 600÷392).
    expect(lockup.querySelector('svg')).toHaveAttribute('height', '34');
    expect(lockup.querySelector('svg')).toHaveAttribute('width', '142');
    expect(mark.querySelector('svg')).toHaveAttribute('height', '34');
    expect(mark.querySelector('svg')).toHaveAttribute('width', '52');
  });

  it('is decorative without a label and an image with one', () => {
    const { container } = render(<Logo />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    render(<Logo label="Medora" />);
    expect(screen.getByRole('img', { name: 'Medora' })).toBeInTheDocument();
  });

  it('inherits currentColor unless a brand colour is forced', () => {
    const { container: inherited } = render(<Logo />);
    expect(inherited.firstElementChild).not.toHaveStyle({ color: '#FFFFFF' });

    const { container: forced } = render(<Logo color="light" />);
    expect(forced.firstElementChild).toHaveStyle({ color: 'rgb(255, 255, 255)' });
  });
});
