import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { declared } from '@/test/tokens';

import { Input } from './Input';
import { TEXT_ENTRY_TOUCH_FONT, fieldInputClasses } from './internal/styles';
import { PasswordInput } from './PasswordInput';
import { SearchInput } from './SearchInput';
import { Select } from './Select';
import { Textarea } from './Textarea';

/**
 * iOS Safari zooms into any focused text field set below 16px. Every
 * text-entry control renders 16px on a coarse pointer (`touch:`) and keeps
 * the compact 13px `text-body` on a fine one. jsdom evaluates no media
 * query, so the classes are what is checked.
 */
describe('text-entry fields on a coarse pointer', () => {
  it('uses the type scale step that is exactly 16px', () => {
    expect(declared('text-h3', 'light')).toBe('1rem');
    expect(TEXT_ENTRY_TOUCH_FONT).toBe('touch:text-h3');
  });

  it.each([
    ['Input', () => render(<Input label="Name" />), () => screen.getByLabelText('Name')],
    [
      'date Input',
      () => render(<Input label="Date" type="date" />),
      () => screen.getByLabelText('Date'),
    ],
    [
      'time Input',
      () => render(<Input label="Time" type="time" />),
      () => screen.getByLabelText('Time'),
    ],
    [
      'PasswordInput',
      () => render(<PasswordInput label="Password" />),
      () => screen.getByLabelText('Password'),
    ],
    [
      'SearchInput',
      () => render(<SearchInput aria-label="Search" />),
      () => screen.getByRole('searchbox', { name: 'Search' }),
    ],
    ['Textarea', () => render(<Textarea label="Notes" />), () => screen.getByLabelText('Notes')],
  ])('%s types at 16px on touch and 13px otherwise', (_name, mount, field) => {
    mount();
    expect(field()).toHaveClass('text-body', 'touch:text-h3');
  });

  it('leaves the Select trigger (a button, not a text field) alone', () => {
    render(
      <Select
        label="Status"
        value="a"
        onChange={() => undefined}
        options={[{ value: 'a', label: 'A' }]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Status' })).not.toHaveClass('touch:text-h3');
    expect(fieldInputClasses({ textEntry: false })).not.toContain('touch:text-h3');
  });
});
