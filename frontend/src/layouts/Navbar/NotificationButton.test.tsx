import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bell } from 'lucide-react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  // A stubbed visualViewport must not leak into later tests if one fails.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('follows the bell when the page scrolls, and when the visual viewport resizes', async () => {
    const user = userEvent.setup();
    renderBell();

    let top = 6;
    const rect = () =>
      ({
        top,
        bottom: top + 40,
        left: 900,
        right: 940,
        width: 40,
        height: 40,
        x: 900,
        y: top,
      }) as DOMRect;
    vi.spyOn(bell(), 'getBoundingClientRect').mockImplementation(rect);

    await user.click(bell());
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(panel.style.top).toBe('54px');

    // A scroll anywhere (captured, so a scrolling ancestor counts too).
    top = -30;
    fireEvent.scroll(window);
    await waitFor(() => expect(panel.style.top).toBe('18px'));

    // The mobile visual viewport (keyboard, pinch) — when the browser has one.
    const listeners = new Map<string, EventListener>();
    const visualViewport = {
      addEventListener: vi.fn((type: string, listener: EventListener) =>
        listeners.set(type, listener),
      ),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('visualViewport', visualViewport);
    // Re-subscribe with the stub in place: close and reopen.
    await user.click(bell());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(bell());
    const reopened = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(listeners.has('resize')).toBe(true);

    top = 100;
    act(() => listeners.get('resize')?.(new Event('resize')));
    await waitFor(() => expect(reopened.style.top).toBe('148px'));
  });

  it('does not close when the panel itself is clicked', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(bell());
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    await user.click(panel);
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
  });
});
