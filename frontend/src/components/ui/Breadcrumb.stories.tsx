import type { Meta, StoryObj } from '@storybook/react-vite';

import { Breadcrumb } from './Breadcrumb';

/**
 * DS §8.18. Links for every ancestor, plain text for the current page, and a
 * collapsed middle once the trail is longer than `maxVisible`.
 */
const meta = {
  title: 'UI/Breadcrumb',
  component: Breadcrumb,
  args: {
    items: [
      { label: 'Overview', href: '#overview' },
      { label: 'Patients', href: '#patients' },
      { label: 'Khaled Nassar' },
    ],
  },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = {
  name: 'Longer than maxVisible',
  args: {
    maxVisible: 3,
    items: [
      { label: 'Overview', href: '#a' },
      { label: 'Administration', href: '#b' },
      { label: 'Platform Settings', href: '#c' },
      { label: 'Users & Permissions', href: '#d' },
      { label: 'Marcus Reed' },
    ],
  },
};

export const SingleLevel: Story = { args: { items: [{ label: 'Overview' }] } };
