import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tabs, type TabItem } from './Tabs';

/** DS §8.17. Roving tabindex, arrow keys, counts, a disabled tab, two variants. */
const ITEMS: readonly TabItem[] = [
  { value: 'inbox', label: 'Inbox', count: 7, content: <p className="pt-3">Results to review.</p> },
  { value: 'all', label: 'All results', count: 25, content: <p className="pt-3">Everything.</p> },
  { value: 'archived', label: 'Archived', disabled: true },
];

function Controlled({ variant }: { variant: 'line' | 'enclosed' }) {
  const [value, setValue] = useState('inbox');
  return (
    <Tabs
      items={ITEMS}
      value={value}
      onValueChange={setValue}
      variant={variant}
      aria-label="Lab results"
    />
  );
}

const meta = {
  title: 'UI/Tabs',
  component: Tabs,
  args: { items: ITEMS, value: 'inbox', onValueChange: () => {}, 'aria-label': 'Tabs' },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Line: Story = { render: () => <Controlled variant="line" /> };
export const Enclosed: Story = { render: () => <Controlled variant="enclosed" /> };
