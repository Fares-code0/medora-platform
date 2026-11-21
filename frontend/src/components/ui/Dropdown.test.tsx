import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Moon, Sun } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

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
