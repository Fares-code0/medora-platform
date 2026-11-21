import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Fact, FactGrid } from './FactList';

/**
 * `Fact` truncates by default, which suits a name or an address in a
 * narrow card. A phone number does not survive it — "+20 100 214 33…" is
 * not a number anyone can dial — so `truncate={false}` lets it wrap.
 */
describe('Fact', () => {
  it('truncates its value by default', () => {
    render(
      <FactGrid>
        <Fact label="Address">Building 14, Al-Rabwa Street</Fact>
      </FactGrid>,
    );
    expect(screen.getByText('Building 14, Al-Rabwa Street')).toHaveClass('truncate');
  });

  it('wraps instead when the value must be read whole', () => {
    render(
      <FactGrid>
        <Fact label="Phone" truncate={false}>
          +20 100 214 3387
        </Fact>
      </FactGrid>,
    );
    const value = screen.getByText('+20 100 214 3387');
    expect(value).not.toHaveClass('truncate');
    expect(value).toHaveClass('break-words');
  });
});
