import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge, type BadgeEmphasis, type BadgeVariant } from './Badge';

/**
 * ADR-0001 §12 makes emphasis the second dimension: hue alone cannot
 * separate fourteen status kinds across six variants. This story is the
 * grid that claim has to survive — every variant in every emphasis, in
 * both themes.
 */

const VARIANTS: readonly BadgeVariant[] = ['success', 'warning', 'error', 'info', 'neutral', 'ai'];
const EMPHASES: readonly BadgeEmphasis[] = ['filled', 'outline'];

const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: { children: 'Label' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { variant: 'neutral' } };

export const Matrix: Story = {
  name: 'Every variant × emphasis',
  render: (args) => (
    <div className="flex flex-col gap-4">
      {EMPHASES.map((emphasis) => (
        <div key={emphasis} className="flex flex-wrap items-center gap-3">
          <span className="w-20 shrink-0 text-caption text-text-secondary">{emphasis}</span>
          {VARIANTS.map((variant) => (
            <Badge key={variant} {...args} variant={variant} emphasis={emphasis}>
              {variant}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  ),
};
