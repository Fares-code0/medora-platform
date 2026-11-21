import type { Meta, StoryObj } from '@storybook/react-vite';

import { AvatarGroup } from './AvatarGroup';

const TEAM = [
  { name: 'Amelia Chen' },
  { name: 'Julian Park' },
  { name: 'Priya Nair' },
  { name: 'Tomas Ellis' },
  { name: 'Lena Hart' },
  { name: 'Marcus Reed' },
];

/** DS §8.22: overlapping avatars, at most `max` visible, the rest as "+N". */
const meta = {
  title: 'UI/AvatarGroup',
  component: AvatarGroup,
  args: { avatars: TEAM },
} satisfies Meta<typeof AvatarGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overflow: Story = { name: 'More than max (+N)' };
export const FitsWithinMax: Story = { args: { avatars: TEAM.slice(0, 3) } };
export const Small: Story = { args: { size: 'sm', max: 3 } };
