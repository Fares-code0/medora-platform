import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { staggerDelay } from '@/styles/motion';

import { Stagger } from './Stagger';

/**
 * Stagger's whole reason to exist is that it owns the entrance index, so two
 * siblings cannot share one — the defect it replaced, where OverviewPage passed
 * index={8} to two widgets by hand and they animated in together.
 *
 * The delay lands in a Framer `transition` prop, which jsdom cannot read off the
 * DOM, so this file mocks the motion layer and records what each item was asked
 * to animate with. It lives apart from Stagger.test.tsx so that file keeps
 * exercising the real `m.div`.
 */
const recordedDelays: number[] = [];

vi.mock('framer-motion', () => ({
  m: {
    div: ({
      children,
      className,
      transition,
    }: {
      children?: React.ReactNode;
      className?: string;
      transition?: { delay?: number };
    }) => {
      recordedDelays.push(transition?.delay ?? -1);
      return <div className={className}>{children}</div>;
    },
  },
}));

function renderItems(count: number, startIndex?: number) {
  recordedDelays.length = 0;
  const items = Array.from({ length: count }, (_, i) => ({
    key: String(i),
    content: <p>item {i}</p>,
  }));
  render(startIndex === undefined ? <Stagger items={items} /> : <Stagger items={items} startIndex={startIndex} />);
  return [...recordedDelays];
}

describe('Stagger entrance delays', () => {
  it('spaces items one stagger step apart, starting at zero', () => {
    expect(renderItems(3)).toEqual([staggerDelay(0), staggerDelay(1), staggerDelay(2)]);
  });

  it('offsets every item by startIndex, so a band can continue an earlier sequence', () => {
    // Without startIndex being honoured this would come back as [0, s, 2s].
    expect(renderItems(3, 3)).toEqual([staggerDelay(3), staggerDelay(4), staggerDelay(5)]);
  });

  it('never assigns one delay twice within a band', () => {
    const delays = renderItems(5, 1);
    expect(new Set(delays).size).toBe(delays.length);
  });

  it('shares the capped delay once past the cap, rather than crawling on', () => {
    const delays = renderItems(3, 20);
    expect(new Set(delays).size).toBe(1);
    expect(delays[0]).toBe(staggerDelay(20));
  });
});
