import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextMenu } from './ContextMenu';
import type { MenuEntry } from './internal/MenuList';

/**
 * A right-click menu on a 320×640 phone: measured, clamped inside the screen
 * on both axes, flipped above the pointer near the bottom, height capped so
 * it scrolls inside its own surface, and closed by a page scroll or resize.
 */

const entries: readonly MenuEntry[] = Array.from({ length: 12 }, (_, i) => ({
  id: `item-${i}`,
  label: `Item ${i}`,
  onSelect: vi.fn(),
}));

function stubLayout() {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-floating-scroller') ? 300 : 0;
  });
}

function openAt(x: number, y: number) {
  render(
    <ContextMenu entries={entries} menuLabel="Row actions">
      <div>Target row</div>
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText('Target row'), { clientX: x, clientY: y });
  return screen.getByRole('menu', { name: 'Row actions' }).parentElement as HTMLElement;
}

describe('ContextMenu on a narrow screen', () => {
  beforeEach(stubLayout);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clamps horizontally and flips above the pointer near the bottom', () => {
    const surface = openAt(300, 600);
    // Right edge kept 8px inside: 320 - 8 - 200.
    expect(surface.style.left).toBe('112px');
    // No room below 600 → opens upward, its bottom edge 4px above the pointer.
    expect(surface.style.bottom).toBe(`${640 - (600 - 4)}px`);
    expect(surface.style.top).toBe('');
    // 60% of the 640px viewport, below the 400px design cap.
    expect(surface.style.maxHeight).toBe('384px');
    expect(surface.style.maxWidth).toBe('304px');
    expect(surface.style.opacity).toBe('');
  });

  it('stays open when its own list scrolls, closes on a page scroll', () => {
    const surface = openAt(20, 20);
    const menu = screen.getByRole('menu');
    act(() => {
      menu.dispatchEvent(new Event('scroll'));
    });
    expect(surface.isConnected).toBe(true);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on a viewport resize', () => {
    openAt(20, 20);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
