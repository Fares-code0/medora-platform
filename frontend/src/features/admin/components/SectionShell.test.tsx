import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SECTION_META } from '../administration.meta';

import { Panel } from './primitives';
import { SectionShell } from './SectionShell';

/**
 * Admin page heading structure — DS §3.4.
 * Doctor pages get their single h1 from ContentHeader; admin sections get
 * theirs from SectionShell, which used to emit h2 and left 14 of 16 admin
 * pages with no h1 at all. Panels sit directly beneath it, so they are h2.
 */
describe('SectionShell', () => {
  it('renders the section title as the page h1', () => {
    render(
      <SectionShell slug="staff">
        <p>body</p>
      </SectionShell>,
    );

    expect(
      screen.getByRole('heading', { name: SECTION_META.staff.label, level: 1 }),
    ).toBeInTheDocument();
  });

  it('produces no heading-level skip with a Panel inside it', () => {
    render(
      <SectionShell slug="rooms">
        <Panel title="Occupancy">body</Panel>
      </SectionShell>,
    );

    const levels = screen
      .getAllByRole('heading')
      .map((h) => Number(h.tagName.slice(1)))
      .sort((a, b) => a - b);

    expect(levels[0]).toBe(1);
    levels.forEach((level, index) => {
      if (index > 0) expect(level - (levels[index - 1] ?? level)).toBeLessThanOrEqual(1);
    });
  });
});

/**
 * The admin area's page frame — the reason it read as a second product.
 *
 * Every admin section renders straight into the shell's `<main>`, so
 * SectionShell is the only thing between the section and the viewport edge.
 * It supplied no container at all: no gutter, no vertical rhythm, and no max
 * width, which on a wide monitor stretched a toolbar the full viewport while
 * every doctor page capped at 1440. That was true of all 22 sections at once,
 * which is why it is asserted here rather than on any one of them.
 *
 * Asserted through the CLASSES PageContainer emits rather than by looking for
 * the component: jsdom computes no layout, so the rendered geometry cannot be
 * measured, and a test that only checked "a div is present" would pass against
 * the very bug it exists to catch.
 */
describe('the admin page frame', () => {
  it('gives the section the same container the doctor pages use', () => {
    const { container } = render(
      <SectionShell slug="staff">
        <p>body</p>
      </SectionShell>,
    );

    const frame = container.firstElementChild;
    // Width cap, horizontal gutters, and the page's own vertical rhythm —
    // the three things a page flush against the viewport was missing.
    expect(frame).toHaveClass('max-w-container-2xl');
    expect(frame).toHaveClass('px-4', 'md:px-6', 'xl:px-8');
    expect(frame).toHaveClass('py-4', 'md:py-5');
  });
});
