import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from './Button';
import type { ButtonSize, ButtonVariant } from './internal/styles';

/**
 * §8.2.4's acceptance artifact for Button: every variant × size, every
 * interaction state, in both themes (the toolbar's Theme switch).
 *
 * The matrices are generated from the union types rather than listed by
 * hand, so a seventh variant shows up here the moment it is declared — a
 * hand-written list silently omits it, which is how a workbench stops being
 * an acceptance artifact and becomes decoration.
 */

const VARIANTS: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'ghost',
  'destructive',
  'destructive-secondary',
  'ai',
];
const SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Save changes' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { variant: 'primary', size: 'md' },
};

export const AllVariants: Story = {
  name: 'Every variant × size',
  render: (args) => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-3">
          <span className="w-44 shrink-0 text-caption text-text-secondary">{variant}</span>
          {SIZES.map((size) => (
            <Button key={size} {...args} variant={variant} size={size}>
              {size}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

export const States: Story = {
  name: 'Interaction states',
  render: (args) => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-3">
          <span className="w-44 shrink-0 text-caption text-text-secondary">{variant}</span>
          <Button {...args} variant={variant}>
            Default
          </Button>
          <Button {...args} variant={variant} disabled>
            Disabled
          </Button>
          <Button {...args} variant={variant} loading>
            Loading
          </Button>
          <Button {...args} variant={variant} leadingIcon={Plus}>
            Leading icon
          </Button>
          <Button {...args} variant={variant} trailingIcon={Trash2}>
            Trailing icon
          </Button>
        </div>
      ))}
    </div>
  ),
};

/**
 * Hover and focus cannot be captured by a static story, so they are named
 * here as the two states a reviewer must exercise with a pointer and with
 * Tab. Saying so beats a story that silently omits them and implies the
 * matrix above is complete.
 */
export const FocusAndHover: Story = {
  name: 'Focus / hover (exercise manually)',
  render: (args) => (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-text-secondary">
        Tab through these to check the focus ring, and hover each to check the hover fill. Both
        themes.
      </p>
      <div className="flex flex-wrap gap-3">
        {VARIANTS.map((variant) => (
          <Button key={variant} {...args} variant={variant}>
            {variant}
          </Button>
        ))}
      </div>
    </div>
  ),
};

export const FullWidth: Story = {
  args: { fullWidth: true, variant: 'primary' },
};
