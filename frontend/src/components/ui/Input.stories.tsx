import type { Meta, StoryObj } from '@storybook/react-vite';
import { Mail, Search } from 'lucide-react';

import { Input } from './Input';

/**
 * Field states are where a design system earns its keep, so every one it
 * declares is here: rest, helper, error, disabled, both sizes, with and
 * without icons. `lg` exists for patient-facing forms; a reviewer should be
 * able to see that difference side by side rather than take it on trust.
 */

const meta = {
  title: 'UI/Input',
  component: Input,
  args: { label: 'Email address', placeholder: 'name@medora.health' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: (args) => (
    <div className="grid max-w-xl gap-4">
      <Input {...args} />
      <Input {...args} helperText="We only use this for sign-in." />
      <Input {...args} error="Enter a valid email address." defaultValue="not-an-email" />
      <Input {...args} disabled defaultValue="locked@medora.health" />
      <Input {...args} leadingIcon={Mail} />
      <Input {...args} label="Search" leadingIcon={Search} placeholder="Search patients…" />
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="grid max-w-xl gap-4">
      <Input {...args} size="md" label="Default (40px)" />
      <Input {...args} size="lg" label="Large — patient-facing forms (48px)" />
    </div>
  ),
};
