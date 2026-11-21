import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChartLegend } from './ChartLegend';

const ITEMS = [
  { key: 'visits', label: 'Visits', tone: 'chart1' },
  { key: 'no-shows', label: 'No-shows', tone: 'chart3' },
] as const;

describe('ChartLegend', () => {
  it('states each series as a pressed toggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ChartLegend items={ITEMS} hidden={new Set(['no-shows'])} onToggle={onToggle} />);

    expect(screen.getByRole('button', { name: 'Visits' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'No-shows' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(screen.getByRole('button', { name: 'No-shows' }));
    expect(onToggle).toHaveBeenCalledWith('no-shows');
  });

  /*
   * A hidden series is still an operable control — the way to bring it
   * back — so its label is held to 4.5:1. `text-disabled` measured 3.44:1
   * (light) and 3.39:1 (dark) under axe; the strike-through, not a fainter
   * colour, says it is off.
   */
  it('dims a hidden series with a legible colour and a strike-through, not the disabled colour', () => {
    render(<ChartLegend items={ITEMS} hidden={new Set(['no-shows'])} onToggle={() => {}} />);
    const off = screen.getByRole('button', { name: 'No-shows' });

    expect(off).toHaveClass('line-through', 'text-text-tertiary');
    expect(off).not.toHaveClass('text-text-disabled');
  });
});
