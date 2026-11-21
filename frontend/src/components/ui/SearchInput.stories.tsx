import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { SearchInput } from './SearchInput';

/** The search field: leading icon, and a clear button once there is text. */
function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SearchInput
      aria-label="Search patients"
      placeholder="Search name, MRN or ID"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClear={() => setValue('')}
    />
  );
}

const meta = {
  title: 'UI/SearchInput',
  component: SearchInput,
  args: { 'aria-label': 'Search' },
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { render: () => <Controlled initial="" /> };
export const WithText: Story = { render: () => <Controlled initial="Khaled" /> };
export const Disabled: Story = { args: { disabled: true, placeholder: 'Search' } };
