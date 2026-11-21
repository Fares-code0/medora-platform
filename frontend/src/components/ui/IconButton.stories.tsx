import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, Pencil, Trash2 } from 'lucide-react';

import { IconButton } from './IconButton';
import type { ButtonSize, IconButtonVariant } from './internal/styles';

/** An icon-only control always carries an accessible name (`aria-label` is required). */
const VARIANTS: readonly IconButtonVariant[] = [
  'neutral',
  'primary',
  'secondary',
  'ghost',
  'destructive',
  'destructive-secondary',
  'ai',
];
const SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];

const meta = {
  title: 'UI/IconButton',
  component: IconButton,
  args: { icon: Pencil, 'aria-label': 'Edit' },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  name: 'Every variant × size',
  render: () => (
    <div className="flex flex-col gap-3">
      {SIZES.map((size) => (
        <div key={size} className="flex items-center gap-3">
          <span className="w-8 text-caption text-text-secondary">{size}</span>
          {VARIANTS.map((variant) => (
            <IconButton
              key={variant}
              icon={variant.startsWith('destructive') ? Trash2 : Bell}
              aria-label={`${variant} ${size}`}
              variant={variant}
              size={size}
            />
          ))}
        </div>
      ))}
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex gap-3">
      <IconButton icon={Bell} aria-label="Loading" loading />
      <IconButton icon={Bell} aria-label="Disabled" disabled />
    </div>
  ),
};
