import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar, type AvatarSize } from './Avatar';

/**
 * DS §8.22. Initials on a deterministic hue when there is no photo, a role
 * ring for staff, and a presence dot. `decorative` drops the avatar from the
 * accessibility tree when the name is printed beside it.
 */

const SIZES: readonly AvatarSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];
const PEOPLE = ['Amelia Chen', 'Omar Farouk', 'Mona Adel', 'Layla Mansour', 'Khaled Nassar'];

const meta = {
  title: 'UI/Avatar',
  component: Avatar,
  args: { name: 'Amelia Chen' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-4">
      {SIZES.map((size) => (
        <Avatar key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

export const InitialsHues: Story = {
  name: 'Initials across names (deterministic hue)',
  render: () => (
    <div className="flex gap-3">
      {PEOPLE.map((name) => (
        <Avatar key={name} name={name} />
      ))}
    </div>
  ),
};

export const RoleRingsAndPresence: Story = {
  name: 'Role rings and presence',
  render: () => (
    <div className="flex gap-4">
      <Avatar name="Amelia Chen" roleRing="doctor" status="online" />
      <Avatar name="Priya Nair" roleRing="staff" />
      <Avatar name="Marcus Reed" roleRing="admin" />
      <Avatar name="Mona Adel" />
    </div>
  ),
};

export const BrokenPhoto: Story = {
  name: 'Photo that fails to load falls back to initials',
  args: { src: '/does-not-exist.png' },
};
