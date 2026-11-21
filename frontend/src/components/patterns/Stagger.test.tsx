import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { motionTokens, staggerDelay } from '@/styles/motion';

import { Stagger } from './Stagger';

/**
 * Stagger owns the entrance index so callers cannot repeat one — the defect
 * it replaces, where OverviewPage passed index={8} to two different widgets
 * and they animated in together.
 */
describe('staggerDelay', () => {
  it('spaces items by one stagger token', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBeCloseTo(motionTokens.stagger);
    expect(staggerDelay(3)).toBeCloseTo(motionTokens.stagger * 3);
  });

  it('caps the delay so a long list never crawls in', () => {
    const capped = staggerDelay(motionTokens.staggerCap);

    expect(staggerDelay(20)).toBe(capped);
    expect(staggerDelay(9)).toBe(capped);
  });

  it('resolves the 30ms vs 40-60ms conflict at 50ms', () => {
    expect(motionTokens.stagger).toBe(0.05);
  });
});

describe('Stagger', () => {
  it('renders every item once, in order', () => {
    render(
      <Stagger
        items={[
          { key: 'a', content: <p>First</p> },
          { key: 'b', content: <p>Second</p> },
          { key: 'c', content: <p>Third</p> },
        ]}
      />,
    );

    const paragraphs = screen.getAllByText(/First|Second|Third/);
    expect(paragraphs.map((node) => node.textContent)).toEqual(['First', 'Second', 'Third']);
  });

  it('applies each item’s own layout class to its wrapper', () => {
    render(
      <Stagger
        items={[
          { key: 'wide', className: 'lg:col-span-2', content: <p>Wide</p> },
          { key: 'narrow', content: <p>Narrow</p> },
        ]}
      />,
    );

    expect(screen.getByText('Wide').parentElement).toHaveClass('lg:col-span-2');
    expect(screen.getByText('Narrow').parentElement).not.toHaveClass('lg:col-span-2');
  });
});
