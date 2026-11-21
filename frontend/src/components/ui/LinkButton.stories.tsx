import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, ExternalLink } from 'lucide-react';

import type { ButtonVariant } from './internal/styles';
import { LinkButton } from './LinkButton';

/** A link that looks like a button — navigation, never an action. */
const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'ai'];

const meta = {
  title: 'UI/LinkButton',
  component: LinkButton,
  args: { href: '#appointments', children: 'Open schedule' },
} satisfies Meta<typeof LinkButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-3">
      {VARIANTS.map((variant) => (
        <LinkButton key={variant} {...args} variant={variant} trailingIcon={ArrowRight}>
          {variant}
        </LinkButton>
      ))}
    </div>
  ),
};

export const DisabledAndFullWidth: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-3">
      <LinkButton {...args} disabled>
        Disabled link
      </LinkButton>
      <LinkButton {...args} fullWidth leadingIcon={ExternalLink}>
        Full width
      </LinkButton>
    </div>
  ),
};
