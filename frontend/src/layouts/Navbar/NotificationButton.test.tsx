import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bell } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ShellBadgesContext, type ShellBadgesValue } from '../badge-context';

import { NotificationButton } from './NotificationButton';

/**
 * The bell opens a popover anchored to itself, not the full-height Drawer it
 * used to. What is pinned here is the behaviour that changed with it: the
 * panel is a labelled dialog tied to the bell by `aria-controls`, and it
 * closes the three ways a non-modal popover should — Escape (handing focus
 * back to the bell), a click outside, and the bell itself.
 */

function badges(overrides: Partial<ShellBadgesValue> = {}): ShellBadgesValue {
  return {
    counts: { notifications: 1, messages: 0, pendingRequests: 0 },
    feed: [
      {
        id: 'ntf_1',
        title: 'Lab results available',
        detail: 'Results for Amira Saleh are verified.',
        timeLabel: 'Today',
        unread: true,
        icon: Bell,
        iconClass: 'bg-info-subtle text-info',
      },
    ],
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    clearRead: vi.fn(),
    viewAllHref: '/doctor/notifications',
    ...overrides,
  };
}

function renderBell(value = badges()) {
  return render(
    <MemoryRouter>
      <ShellBadgesContext.Provider value={value}>
        <button type="button">Elsewhere</button>
        <NotificationButton />
      </ShellBadgesContext.Provider>
    </MemoryRouter>,
  );
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ });

describe('the notification bell', () => {
  it('opens the feed in a dialog the bell controls', async () => {
    const user = userEvent.setup();
    renderBell();

    expect(bell()).toHaveAttribute('aria-expanded', 'false');
    await user.click(bell());

    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(bell()).toHaveAttribute('aria-expanded', 'true');
    expect(bell()).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('Lab results available');
    expect(screen.getByRole('link', { name: 'View all notifications' })).toHaveAttribute(
      'href',
      '/doctor/notifications',
    );
  });

  it('closes on Escape and returns focus to the bell', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(bell());
    await screen.findByRole('dialog', { name: 'Notifications' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bell()).toHaveFocus();
  });

  it('closes on a click outside, and when the bell is pressed again', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(bell());
    await screen.findByRole('dialog', { name: 'Notifications' });
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(bell());
    await screen.findByRole('dialog', { name: 'Notifications' });
    await user.click(bell());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('still marks a row read and everything read from the panel', async () => {
    const user = userEvent.setup();
    const value = badges();
    renderBell(value);

    await user.click(bell());
    await user.click(await screen.findByRole('button', { name: /Lab results available/ }));
    expect(value.markRead).toHaveBeenCalledWith('ntf_1');

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(value.markAllRead).toHaveBeenCalled();
  });
});
