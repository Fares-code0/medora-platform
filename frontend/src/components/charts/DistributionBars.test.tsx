import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DistributionBars } from './DistributionBars';

/**
 * Pins the defect the F-14 audit found: this chart carries `role="img"` so a
 * screen reader hears one labelled figure rather than N bars read as a list.
 * It used to do that on a `<ul>`, where the role overrode the list semantics
 * and orphaned its own `<li>` children — axe `listitem`, serious, WCAG A/AA,
 * live on /doctor/reports.
 *
 * The rule this encodes is general: an element whose role is not `list` must
 * not have `<li>` children, whatever it is styled to look like.
 */

const SERIES = {
  name: 'Age',
  tone: 'chart1',
  points: [
    { label: '18–34', value: 12 },
    { label: '35–49', value: 20 },
    { label: '50–64', value: 8 },
  ],
} as const;

describe('DistributionBars accessibility', () => {
  it('exposes one labelled figure rather than a list of bars', () => {
    const { getByRole } = render(
      <DistributionBars series={SERIES} ariaLabel="Patient age distribution" />,
    );
    expect(getByRole('img', { name: 'Patient age distribution' })).toBeInTheDocument();
  });

  it('contains no list items, because its role is not list', () => {
    const { container, queryAllByRole } = render(
      <DistributionBars series={SERIES} ariaLabel="Patient age distribution" />,
    );
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(queryAllByRole('listitem')).toHaveLength(0);
  });

  it('still renders every point, so the fix did not drop data', () => {
    const { getByText } = render(
      <DistributionBars series={SERIES} ariaLabel="Patient age distribution" />,
    );
    for (const point of SERIES.points) expect(getByText(point.label)).toBeInTheDocument();
  });
});
