import { useState, type ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { SearchBar } from './SearchBar';

/**
 * A labelled search field with an optional debounced callback and a result
 * count, announced politely as the list narrows.
 */
function Controlled(props: Omit<ComponentProps<typeof SearchBar>, 'value' | 'onValueChange'>) {
  const [value, setValue] = useState('');
  return <SearchBar {...props} value={value} onValueChange={setValue} />;
}

const meta = {
  title: 'Patterns/SearchBar',
  component: SearchBar,
  args: {
    value: '',
    onValueChange: () => {},
    label: 'Search patients',
    placeholder: 'Name or MRN',
  },
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { render: (args) => <Controlled {...args} /> };

export const WithResults: Story = { args: { value: 'khal', resultCount: 3 } };

export const OneResult: Story = { args: { value: 'MRN-10042', resultCount: 1 } };

export const NoResults: Story = { args: { value: 'zzz', resultCount: 0 } };

export const Disabled: Story = { args: { disabled: true } };
