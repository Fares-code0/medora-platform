import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreHorizontal } from 'lucide-react';

import { Button } from './Button';
import { Card, type CardTone } from './Card';
import { IconButton } from './IconButton';

/** DS §8.20. Title, subtitle, header action, footer, padding, tone bar, interactive. */
const TONES: readonly CardTone[] = [
  'none',
  'primary',
  'secondary',
  'success',
  'warning',
  'error',
  'info',
  'ai',
];

const meta = {
  title: 'UI/Card',
  component: Card,
  args: {
    title: 'Today’s schedule',
    subtitle: '5 appointments',
    children: <p className="text-body-sm text-text-secondary">Card body content.</p>,
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithActionAndFooter: Story = {
  args: {
    headerAction: <IconButton icon={MoreHorizontal} aria-label="Card actions" size="sm" />,
    footer: <Button size="sm">View all</Button>,
  },
};

export const Tones: Story = {
  render: (args) => (
    <div className="grid grid-cols-2 gap-4">
      {TONES.map((tone) => (
        <Card key={tone} {...args} tone={tone} title={`Tone: ${tone}`} />
      ))}
    </div>
  ),
};

export const Padding: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Card {...args} padding="default" title="Default padding" />
      <Card {...args} padding="compact" title="Compact padding" />
      <Card {...args} padding="none" title="No padding" />
    </div>
  ),
};

export const Interactive: Story = {
  name: 'Interactive (whole card is the control)',
  args: { interactive: true, tabIndex: 0, title: 'Open Khaled Nassar' },
};
