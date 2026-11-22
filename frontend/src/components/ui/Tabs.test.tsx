import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('Tabs enclosed touch area', () => {
  it('reserves the 44px target as margin inside the clipping tablist, not as overflow', () => {
    render(
      <Tabs
        items={items}
        value="a"
        onValueChange={() => {}}
        variant="enclosed"
        aria-label="Sections"
      />,
    );
    const list = screen.getByRole('tablist');
    const tab = screen.getByRole('tab', { name: 'Overview' });
    // h-9 (36px) + 2 x --touch-y (4px) = 44px. The touch-target rule turns the
    // gutter into MARGIN (layout space inside the scrollport) and fills it with
    // ::after, so the overflow-y-hidden track never clips the hit area.
    expect(tab).toHaveClass('touch-target', 'h-9', '[--touch-y:4px]');
    expect(list).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
    // Not absolute/fixed, which would opt out of the margin gutter.
    expect(tab).not.toHaveClass('absolute');
    expect(tab).not.toHaveClass('fixed');
  });
});

function Controlled({ variant }: { variant: 'line' | 'enclosed' }) {
  const [value, setValue] = useState('a');
  return (
    <Tabs
      items={[
        { value: 'a', label: 'One' },
        { value: 'b', label: 'Two', disabled: true },
        { value: 'c', label: 'Three' },
      ]}
      value={value}
      onValueChange={setValue}
      variant={variant}
      aria-label="Sections"
    />
  );
}

describe.each(['line', 'enclosed'] as const)('Tabs keyboard (%s)', (variant) => {
  it('moves with arrows, Home and End, skipping disabled tabs, with a roving tabindex', async () => {
    const user = userEvent.setup();
    render(<Controlled variant={variant} />);
    const one = screen.getByRole('tab', { name: 'One' });
    one.focus();
    await user.keyboard('{ArrowRight}');
    const three = screen.getByRole('tab', { name: 'Three' });
    expect(three).toHaveAttribute('aria-selected', 'true');
    expect(three).toHaveFocus();
    expect(three).toHaveAttribute('tabindex', '0');
    expect(one).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowRight}');
    expect(one).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(three).toHaveFocus();
    await user.keyboard('{Home}');
    expect(one).toHaveFocus();
    await user.keyboard('{End}');
    expect(three).toHaveFocus();
  });

  it('draws the focus ring inset so the clipping tablist cannot cut it', () => {
    render(<Controlled variant={variant} />);
    expect(screen.getByRole('tab', { name: 'One' }).className).toContain(
      'focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus-ring)]',
    );
  });
});
