import { screen } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * F-17 / DS §3.4 — *exactly one `h1` per page, and never a skipped level*.
 *
 * The rule has been asserted by hand since Phase A, and a browser sweep of
 * every doctor and admin route found pages breaking it anyway: a
 * full-height workspace with no `h1` at all (`/doctor/messages`), a
 * Settings page rendering two (`ContentHeader`'s plus the section's), and
 * three admin card grids whose card titles were `h3` directly beneath the
 * page `h1`.
 *
 * Promoted out of `pharmacy/pages/NewPrescriptionPage.test.tsx`, which had
 * written the same walk twice — and whose second copy exists because the
 * first checked one step of a flow and missed a real `h2 → h4` skip on
 * another. That is the argument for a helper rather than a rule of thumb:
 * the check is easy to write and easy to write incompletely.
 */
export function expectSoundHeadingOutline(): void {
  const headings = screen.getAllByRole('heading');
  const levels = headings.map((heading) => Number(heading.tagName.slice(1)));

  expect(
    screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent),
  ).toHaveLength(1);

  // The first heading must be the h1 — a page that opens on an h2 has an
  // outline rooted somewhere the reader never heard.
  expect(levels[0]).toBe(1);

  for (let i = 1; i < levels.length; i += 1) {
    const step = levels[i]! - levels[i - 1]!;
    expect(
      step,
      `heading level skip: h${levels[i - 1]!} "${headings[i - 1]!.textContent ?? ''}" → h${levels[i]!} "${headings[i]!.textContent ?? ''}"`,
    ).toBeLessThanOrEqual(1);
  }
}
