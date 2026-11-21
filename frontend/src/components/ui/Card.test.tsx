import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Card } from './Card';

/**
 * Card heading level — DS §3.4 "never skip levels".
 * A page's ContentHeader owns the single h1, so a card title sitting
 * directly on a page must be h2. Hardcoding h3 produced an h1 → h3 jump on
 * every audited screen; `headingAs` mirrors the same prop on `Section`.
 */
describe('Card', () => {
  it('renders a string title as an h2 by default', () => {
    render(<Card title="Clinic pulse" />);

    expect(screen.getByRole('heading', { name: 'Clinic pulse', level: 2 })).toBeInTheDocument();
  });

  it('honors headingAs for cards nested under an existing h2', () => {
    render(<Card title="Uptime" headingAs="h3" />);

    expect(screen.getByRole('heading', { name: 'Uptime', level: 3 })).toBeInTheDocument();
  });

  it('leaves a ReactNode title alone so callers can own their own markup', () => {
    render(<Card title={<span data-testid="custom">Custom</span>} />);

    expect(screen.getByTestId('custom')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

/**
 * An interactive card is a `role="button"`, and ARIA requires a button to
 * answer both Enter and Space (WCAG 2.1.1). The Space branch was written
 * `event.key === ''` — the empty string, which `KeyboardEvent.key` never is —
 * so it could not fire, and every whole-card click target in the app was
 * Enter-only for keyboard users. Both keys are asserted because the bug was
 * invisible from the Enter side alone.
 */
describe('an interactive Card', () => {
  it.each([
    ['{Enter}', 'Enter'],
    [' ', 'Space'],
  ])('activates on %s', async (key) => {
    const onClick = vi.fn();
    render(<Card interactive onClick={onClick} title="Open patient" />);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Open patient/ })).toHaveFocus();

    await userEvent.keyboard(key);

    expect(onClick).toHaveBeenCalled();
  });

  it('stays inert when it has no click target', () => {
    render(<Card interactive title="Not a target" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
