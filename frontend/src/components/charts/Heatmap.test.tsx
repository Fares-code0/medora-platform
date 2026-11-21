import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Heatmap } from './Heatmap';
import type { HeatmapData } from './types';

/**
 * The heatmap's horizontal scroller (WCAG 2.1.1). Below 420px the grid
 * scrolls sideways; axe's `scrollable-region-focusable` found it unreachable
 * by keyboard at 375px on /doctor/reports. It follows DataTable's rule: a
 * named, focusable region only while it overflows. jsdom has no layout, so
 * the two widths the component compares are stubbed (DataTable.test's idiom).
 */

const data: HeatmapData = {
  rows: ['Mon', 'Tue'],
  columns: ['8am', '10am', '12pm'],
  cells: [
    [1, 4, 2],
    [0, 3, 5],
  ],
  max: 5,
};

function stubScrollGeometry(scrollWidth: number, clientWidth: number) {
  const scroll = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollWidth');
  const client = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => clientWidth,
  });
  return () => {
    if (scroll) Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', scroll);
    if (client) Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', client);
  };
}

describe('Heatmap · the horizontal scroller', () => {
  it('is a named, focusable region while the grid overflows', () => {
    const restore = stubScrollGeometry(420, 343);
    try {
      render(<Heatmap data={data} ariaLabel="Activity heatmap" />);
      const region = screen.getByRole('region', { name: 'Activity heatmap' });
      expect(region).toHaveAttribute('tabindex', '0');
      expect(region).toHaveClass('overflow-x-auto');
      // The figure is still one labelled image inside it.
      expect(screen.getByRole('img', { name: 'Activity heatmap' })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('adds no tab stop and no landmark when the grid fits', () => {
    const restore = stubScrollGeometry(600, 600);
    try {
      render(<Heatmap data={data} ariaLabel="Activity heatmap" />);
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      expect(
        screen.getByRole('img', { name: 'Activity heatmap' }).parentElement,
      ).not.toHaveAttribute('tabindex');
    } finally {
      restore();
    }
  });
});
