import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NotificationViewNav } from './NotificationViewNav';

/**
 * Found in a real browser at 375px: each count pill carries an sr-only span
 * (position: absolute). While the chip row was not positioned, those spans
 * resolved against <main> at their scrolled-off static position and made
 * the whole Notifications page scroll sideways by ~180px. jsdom has no
 * layout, so what is pinned is the cause: the row that scrolls is also the
 * containing block of everything inside it.
 */
describe('NotificationViewNav', () => {
  const counts = { active: 4, unread: 2, read: 2, starred: 1, archived: 9 };

  it('makes its horizontal scroller the containing block of its sr-only text', () => {
    render(<NotificationViewNav value="active" counts={counts} onChange={vi.fn()} />);
    const list = within(screen.getByRole('navigation', { name: 'Notification views' })).getByRole(
      'list',
    );
    expect(list).toHaveClass('overflow-x-auto');
    expect(list).toHaveClass('relative');
  });

  it('still marks the current view and names every view with its count', () => {
    render(<NotificationViewNav value="unread" counts={counts} onChange={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Notification views' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(within(nav).getByRole('button', { name: /^Unread/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
