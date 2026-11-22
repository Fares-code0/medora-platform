import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Moon, Sun } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dropdown, type MenuEntry } from './Dropdown';

/**
 * NEW-36 added a `segmented` entry to the shared menu list that every
 * Dropdown and ContextMenu renders. These pin that ordinary items behave as
 * they did before it — select closes the menu, Left/Right do nothing on them
 * — and that a segmented option is a `menuitemradio` that leaves it open.
 */

function renderMenu(onPlain = vi.fn<() => void>(), onSegment = vi.fn<(mode: string) => void>()) {
  const entries: readonly MenuEntry[] = [
    { id: 'first', label: 'First', onSelect: onPlain },
    { type: 'separator', id: 'sep' },
    {
      type: 'segmented',
      id: 'mode',
      label: 'Mode',
      options: [
        {
          id: 'a',
          label: 'Mode A',
          icon: Sun,
          checked: true,
          onSelect: () => {
            onSegment('a');
          },
        },
        {
          id: 'b',
          label: 'Mode B',
          icon: Moon,
          checked: false,
          onSelect: () => {
            onSegment('b');
          },
        },
      ],
    },
    { id: 'last', label: 'Last', onSelect: vi.fn() },
  ];
  render(
    <Dropdown trigger={<button type="button">Open</button>} entries={entries} menuLabel="Things" />,
  );
  return { onPlain, onSegment };
}

describe('Dropdown with a segmented entry', () => {
  it('still closes the menu when an ordinary item is chosen', async () => {
    const { onPlain } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'First' }));

    expect(onPlain).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps the menu open when a segmented option is chosen', async () => {
    const { onSegment } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Mode B' }));

    expect(onSegment).toHaveBeenCalledWith('b');
    expect(screen.getByRole('menu', { name: 'Things' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument();
  });

  it('ignores Left/Right on an ordinary item, and type-ahead still finds items', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const first = screen.getByRole('menuitem', { name: 'First' });
    expect(first).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}{ArrowLeft}');
    expect(first).toHaveFocus();

    await userEvent.keyboard('l');
    expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus();
  });

  it('walks Up/Down through items and options in order, wrapping at the ends', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Mode A' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Mode B' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
  });
});

/**
 * Mobile behaviour: the menu is fixed-position and must stay on its trigger
 * while the page scrolls — written in the scroll handler itself, not a frame
 * later — and close once the trigger has scrolled out of view.
 */
describe('Dropdown following its trigger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockAnchor() {
    const rect = { top: 100, height: 32, left: 600, width: 40 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      // The trigger's wrapper is the anchor; everything else is unlaid-out.
      const isAnchor = this.querySelector(':scope > button[aria-haspopup]') !== null;
      const { top, height, left, width } = isAnchor
        ? rect
        : { top: 0, height: 0, left: 0, width: 0 };
      return DOMRect.fromRect({ x: left, y: top, width, height });
    });
    return rect;
  }

  it('moves with the trigger synchronously on scroll', async () => {
    const rect = mockAnchor();
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const surface = screen.getByRole('menu').parentElement as HTMLElement;
    expect(surface.style.top).toBe(`${100 + 32 + 4}px`);

    rect.top = 60;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(surface.style.top).toBe(`${60 + 32 + 4}px`);
    expect(surface.style.maxWidth).not.toBe('');
  });

  it('closes once the trigger has scrolled fully out of view', async () => {
    const rect = mockAnchor();
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    rect.top = -200;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('keeps the scroll inside the rounded menu surface', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('overflow-y-auto', 'max-h-[inherit]', 'rounded-surface');
    expect(menu.parentElement).not.toHaveClass('overflow-y-auto');
  });
});
