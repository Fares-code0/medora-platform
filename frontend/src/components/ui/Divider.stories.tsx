import type { Meta, StoryObj } from '@storybook/react-vite';

import { Divider } from './Divider';

const meta = {
  title: 'UI/Divider',
  component: Divider,
} satisfies Meta<typeof Divider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {};
export const WithLabel: Story = { args: { label: 'or' } };
export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <div className="flex h-8 items-center gap-3 text-body-sm">
      <span>Left</span>
      <Divider {...args} />
      <span>Right</span>
    </div>
  ),
};
