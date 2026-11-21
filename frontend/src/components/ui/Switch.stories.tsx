import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Switch } from './Switch';

/** DS §8.11. A switch applies immediately — there is no Save beside one. */
function Controlled(props: {
  label: string;
  description?: string;
  disabled?: boolean;
  on?: boolean;
}) {
  const [checked, setChecked] = useState(props.on ?? false);
  return (
    <Switch
      label={props.label}
      description={props.description}
      disabled={props.disabled ?? false}
      checked={checked}
      onCheckedChange={setChecked}
    />
  );
}

const meta = {
  title: 'UI/Switch',
  component: Switch,
  args: { checked: false, onCheckedChange: () => {}, label: 'Reduce motion' },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Controlled label="Off" />
      <Controlled label="On" on />
      <Controlled
        label="Email digest"
        description="A summary of unread notifications each morning."
        on
      />
      <Controlled label="Disabled" disabled />
      <Controlled label="Disabled and on" disabled on />
    </div>
  ),
};

export const LabelledByAriaLabel: Story = {
  name: 'No visible label (aria-label)',
  args: { label: undefined, 'aria-label': 'Show widget: Notifications' },
  render: (args) => <Switch {...args} />,
};
