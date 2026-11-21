import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell } from 'lucide-react';

import { Avatar } from './Avatar';
import { IconButton } from './IconButton';
import { SearchInput } from './SearchInput';
import { TopNavbar } from './TopNavbar';

/** The app bar: start, centre and end slots; optional elevation and stickiness. */
const meta = {
  title: 'UI/TopNavbar',
  component: TopNavbar,
  args: {
    start: <span className="text-body-sm font-semibold">Overview</span>,
    center: <SearchInput aria-label="Search" placeholder="Search…" />,
    end: (
      <div className="flex items-center gap-2">
        <IconButton icon={Bell} aria-label="Notifications" />
        <Avatar name="Amelia Chen" size="sm" decorative />
      </div>
    ),
  },
} satisfies Meta<typeof TopNavbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Elevated: Story = { args: { elevated: true } };
