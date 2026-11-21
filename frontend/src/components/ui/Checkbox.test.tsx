import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Checkbox } from './Checkbox';

/**
 * Checkbox accessible-name contract — DS §8.5.
 * A checkbox with a visible label must expose that label as its accessible
 * name; otherwise assistive tech announces the input's value ("on"), which
 * tells the user nothing. Regression guard for the login "Remember me" box.
 */
describe('Checkbox', () => {
  it('exposes its visible label as the accessible name', () => {
    render(<Checkbox label="Remember me" />);

    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeInTheDocument();
  });

  it('keeps the accessible name when react-hook-form spreads name/onChange over it', () => {
    render(<Checkbox label="Remember me" name="rememberMe" onChange={() => {}} />);

    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeInTheDocument();
  });

  it('is still operable by clicking the label text', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<Checkbox label="Remember me" />);

    const box = screen.getByRole('checkbox', { name: 'Remember me' });
    expect(box).not.toBeChecked();

    await userEvent.click(screen.getByText('Remember me'));

    expect(box).toBeChecked();
  });
});
