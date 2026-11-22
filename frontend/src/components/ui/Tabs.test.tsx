import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tabs } from './Tabs';

const items = [
  { value: 'a', label: 'Overview' },
  { value: 'b', label: 'History' },
];

describe('Tabs overflow', () => {
  it('scrolls horizontally only', () => {
    render(<Tabs items={items} value="a" onValueChange={() => {}} aria-label="Sections" />);
    const list = screen.getByRole('tablist');
    expect(list).toHaveClass('overflow-x-auto', 'overflow-y-hidden', 'overscroll-x-contain');
  });

  it('keeps the indicator inside the tab box', () => {
    render(<Tabs items={items} value="a" onValueChange={() => {}} aria-label="Sections" />);
    const tab = screen.getByRole('tab', { name: 'Overview' });
    const indicator = tab.querySelector('span[aria-hidden="true"]');
    expect(indicator).not.toBeNull();
    expect(indicator?.className).toContain('bottom-0');
    expect(indicator?.className).not.toContain('-bottom-px');
  });
});
