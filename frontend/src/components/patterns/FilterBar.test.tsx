import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FilterBar } from './FilterBar';

const FILTERS = [
  { id: 'specialty', label: 'Specialty: Cardiology' },
  { id: 'status', label: 'Status: Active' },
];

describe('FilterBar', () => {
  it('holds only list items in its list — "Clear all" sits beside it (axe aria-required-children)', () => {
    render(<FilterBar filters={FILTERS} onRemove={() => {}} onClearAll={() => {}} />);
    const list = screen.getByRole('list', { name: 'Active filters' });

    for (const child of Array.from(list.children)) {
      expect(child).toHaveAttribute('role', 'listitem');
    }
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
  });

  it('removes one filter, or clears them all', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    render(<FilterBar filters={FILTERS} onRemove={onRemove} onClearAll={onClearAll} />);

    await user.click(screen.getByRole('button', { name: 'Remove filter: Status: Active' }));
    expect(onRemove).toHaveBeenCalledWith('status');
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it('offers "Clear all" only from two filters up, and renders no list when none are active', () => {
    const { rerender } = render(
      <FilterBar filters={FILTERS.slice(0, 1)} onRemove={() => {}} onClearAll={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();

    rerender(<FilterBar filters={[]} onRemove={() => {}} onClearAll={() => {}} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
