import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MOCK_STATISTICS } from '../model/mock-data';

import { PracticePulseWidget } from './PracticePulseWidget';

const SPOKEN_DIRECTION = { up: 'up', down: 'down', flat: 'unchanged' } as const;

/**
 * D-02 — reading order. The value paints to the right of the label/delta
 * stack, so the first version of this widget put the delta chip ahead of the
 * value in the DOM and a screen reader read the row backwards: "Avg.
 * consultation duration, 2 min down vs last month, 24 min". These pin the
 * announced order against the layout being flattened back into a flex row.
 */
describe('PracticePulseWidget · reading order', () => {
  it('announces each metric as label, then value, then delta', () => {
    render(<PracticePulseWidget statistics={MOCK_STATISTICS} />);

    for (const stat of MOCK_STATISTICS) {
      const row = screen.getByText(stat.label).parentElement;
      const spokenDelta = stat.delta
        ? `${stat.delta.label} ${SPOKEN_DIRECTION[stat.delta.direction]}${
            stat.delta.comparison ? ` ${stat.delta.comparison}` : ''
          }`
        : '';

      expect(row?.textContent).toBe(`${stat.label}${stat.value}${spokenDelta}`);
    }
  });

  it('still paints the value in the right-hand column, centred against both rows', () => {
    render(<PracticePulseWidget statistics={MOCK_STATISTICS} />);

    for (const stat of MOCK_STATISTICS) {
      const value = screen.getByText(stat.value);
      expect(value.className).toContain('col-start-2');
      expect(value.className).toContain('row-span-2');
    }
  });
});

/**
 * The live pulse: the no-show rate alone, with its denominator. The caption
 * follows the delta in the DOM so the rate is heard before what it was
 * counted from.
 */
describe('PracticePulseWidget · the no-show rate with its denominator', () => {
  const RATE = {
    id: 'no-show-rate',
    label: 'No-show rate (30d)',
    value: '4.2%',
    caption: '3 of 72 appointments',
    delta: {
      direction: 'up',
      label: '1.1 pts',
      tone: 'negative',
      comparison: 'vs previous 30 days',
    },
  } as const;

  it('announces label, value, delta, then the denominator', () => {
    render(<PracticePulseWidget statistics={[RATE]} />);

    const row = screen.getByText(RATE.label).parentElement;
    expect(row?.textContent).toBe(
      'No-show rate (30d)4.2%1.1 pts up vs previous 30 days3 of 72 appointments',
    );
  });

  it('puts the caption on the row below the delta, or below the label without one', () => {
    const { rerender } = render(<PracticePulseWidget statistics={[RATE]} />);
    expect(screen.getByText(RATE.caption).className).toContain('row-start-3');

    rerender(
      <PracticePulseWidget
        statistics={[{ id: RATE.id, label: RATE.label, value: RATE.value, caption: RATE.caption }]}
      />,
    );
    expect(screen.getByText(RATE.caption).className).toContain('row-start-2');
  });

  it('draws only the statistics it is given — never the fixture rows beside them', () => {
    render(<PracticePulseWidget statistics={[RATE]} />);

    expect(screen.queryByText('Avg. consultation duration')).not.toBeInTheDocument();
    expect(screen.queryByText('Request response time')).not.toBeInTheDocument();
  });

  it('shows a window with no appointments as no rate, with the reason', () => {
    render(
      <PracticePulseWidget
        statistics={[
          {
            id: 'no-show-rate',
            label: 'No-show rate (30d)',
            value: '—',
            caption: 'No appointments in the last 30 days',
          },
        ]}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No appointments in the last 30 days')).toBeInTheDocument();
  });
});
