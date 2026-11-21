import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/app/providers/ThemeProvider';

import { ThemeSwitch } from './ThemeSwitch';

/**
 * The theme switch — the sun/moon pill that moved out of the avatar menu to
 * the foot of the sidebar and onto the sign-in screens. It carries NEW-36's
 * contract over: a half per theme, each saying whether it is the theme shown,
 * so a screen reader never hears a label that disagrees with the action.
 *
 * Driven over the real `ThemeProvider` and the real preference store, so
 * "persisted" means what a reload would read.
 */

const THEME_KEY = 'medora.theme';

function prefersDark(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('dark') ? matches : false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

const renderSwitch = (orientation?: 'horizontal' | 'vertical') =>
  render(
    <ThemeProvider>
      <ThemeSwitch orientation={orientation} />
    </ThemeProvider>,
  );

const light = () => screen.getByRole('radio', { name: 'Light theme' });
const dark = () => screen.getByRole('radio', { name: 'Dark theme' });
const indicator = () => {
  const node = document.querySelector<HTMLElement>('[data-segment-indicator]');
  if (node === null) throw new Error('no indicator');
  return node;
};
const isDark = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThemeSwitch', () => {
  it('is a radio group named Theme, with no visible text — sun first, moon second', () => {
    prefersDark(false);
    renderSwitch();
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group.textContent).toBe('');
    expect(
      within(group)
        .getAllByRole('radio')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Light theme', 'Dark theme']);
    for (const item of within(group).getAllByRole('radio')) {
      expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(item).toHaveAttribute('title', item.getAttribute('aria-label'));
    }
    expect(indicator()).toHaveAttribute('aria-hidden', 'true');
  });

  it('starts on light: the sun is checked, highlighted, and the indicator sits behind it', () => {
    prefersDark(false);
    renderSwitch();
    expect(light()).toHaveAttribute('aria-checked', 'true');
    expect(dark()).toHaveAttribute('aria-checked', 'false');
    expect(light()).toHaveClass('text-warning');
    expect(dark()).toHaveClass('text-text-tertiary');
    expect(indicator()).toHaveAttribute('data-position', '0');
  });

  it('starts on dark when dark is stored', () => {
    prefersDark(false);
    window.localStorage.setItem(THEME_KEY, JSON.stringify('dark'));
    renderSwitch();
    expect(isDark()).toBe(true);
    expect(dark()).toHaveAttribute('aria-checked', 'true');
    expect(dark()).toHaveClass('text-primary');
    expect(indicator()).toHaveAttribute('data-position', '1');
  });

  it('switches light → dark on the moon and persists the choice', async () => {
    prefersDark(false);
    const view = renderSwitch();
    await userEvent.click(dark());
    expect(isDark()).toBe(true);
    expect(dark()).toHaveAttribute('aria-checked', 'true');
    expect(indicator()).toHaveAttribute('data-position', '1');
    expect(window.localStorage.getItem(THEME_KEY)).toBe(JSON.stringify('dark'));

    // What a reload reads.
    view.unmount();
    document.documentElement.classList.remove('dark');
    renderSwitch();
    expect(isDark()).toBe(true);
  });

  it('switches dark → light on the sun, and persists that too', async () => {
    prefersDark(false);
    window.localStorage.setItem(THEME_KEY, JSON.stringify('dark'));
    renderSwitch();
    await userEvent.click(light());
    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_KEY)).toBe(JSON.stringify('light'));
  });

  it('shows a `system` preference as what the OS paints, and stores an explicit choice over it', async () => {
    prefersDark(true);
    renderSwitch();
    expect(isDark()).toBe(true);
    expect(dark()).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(light());
    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_KEY)).toBe(JSON.stringify('light'));
  });

  it('works from the keyboard: only the checked half is tabbable, arrows move and choose', async () => {
    prefersDark(false);
    renderSwitch();
    expect(light()).toHaveAttribute('tabindex', '0');
    expect(dark()).toHaveAttribute('tabindex', '-1');

    await userEvent.tab();
    expect(light()).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(dark()).toHaveFocus();
    expect(isDark()).toBe(true);
    // Right at the end stays put.
    await userEvent.keyboard('{ArrowRight}');
    expect(dark()).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(light()).toHaveFocus();
    expect(isDark()).toBe(false);
  });

  it('stacks vertically for the collapsed sidebar rail', () => {
    prefersDark(false);
    renderSwitch('vertical');
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toHaveAttribute('aria-orientation', 'vertical');
    expect(group).toHaveClass('flex-col');
  });
});
