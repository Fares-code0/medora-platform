import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../ui/Button';

import { FilterBar, type ActiveFilter } from './FilterBar';
import { SearchBar } from './SearchBar';

/** Active filters as removable chips, with a search slot and an actions slot. */
const FILTERS: readonly ActiveFilter[] = [
  { id: 'specialty', label: 'Specialty: Cardiology' },
  { id: 'status', label: 'Status: Active' },
  { id: 'ward', label: 'Ward: 3B' },
];

function Interactive() {
  const [filters, setFilters] = useState<readonly ActiveFilter[]>(FILTERS);
  const [query, setQuery] = useState('');
  return (
    <FilterBar
      filters={filters}
      onRemove={(id) => setFilters((current) => current.filter((filter) => filter.id !== id))}
      onClearAll={() => setFilters([])}
      search={<SearchBar value={query} onValueChange={setQuery} label="Search patients" />}
      actions={
        <Button variant="secondary" size="sm" onClick={() => setFilters(FILTERS)}>
          Reset
        </Button>
      }
    />
  );
}

const meta = {
  title: 'Patterns/FilterBar',
  component: FilterBar,
  args: { filters: FILTERS, onRemove: () => {}, onClearAll: () => {} },
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFilters: Story = {};

export const NoFilters: Story = { args: { filters: [] } };

export const RemovableAndSearch: Story = { render: () => <Interactive /> };
