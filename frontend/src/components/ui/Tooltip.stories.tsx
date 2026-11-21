import type { Meta, StoryObj } from '@storybook/react-vite';
import { Info } from 'lucide-react';

import { IconButton } from './IconButton';
import { Tooltip } from './Tooltip';

/**
 * DS §8.21. A tooltip describes its trigger (`aria-describedby`); it never
 * names it — the trigger keeps its own accessible name. Shown on hover and
 * on keyboard focus; Escape hides it.
 */
const meta = {
  title: 'UI/Tooltip',
  component: Tooltip,
  args: {
    content: 'Locked by policy: an administrator always holds this capability.',
    children: <IconButton icon={Info} aria-label="Why is this locked?" />,
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Top: Story = {};
export const Bottom: Story = { args: { placement: 'bottom' } };
export const Right: Story = { args: { placement: 'right' } };
export const Disabled: Story = { args: { disabled: true } };
