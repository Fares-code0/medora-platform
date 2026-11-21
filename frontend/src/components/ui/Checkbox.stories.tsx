import { useState, type ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Checkbox } from './Checkbox';

/** DS §8.9. Checked, indeterminate, disabled, with description and with an error. */
const meta = {
  title: 'UI/Checkbox',
  component: Checkbox,
  args: { label: 'Remember me' },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(props: ComponentProps<typeof Checkbox>) {
  const [checked, setChecked] = useState(Boolean(props.defaultChecked));
  return (
    <Checkbox {...props} checked={checked} onChange={(event) => setChecked(event.target.checked)} />
  );
}

export const Playground: Story = { render: (args) => <Controlled {...args} /> };

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Controlled label="Unchecked" />
      <Controlled label="Checked" defaultChecked />
      <Checkbox label="Indeterminate (some rows selected)" indeterminate readOnly />
      <Checkbox label="Disabled" disabled />
      <Checkbox label="Disabled and checked" disabled checked readOnly />
      <Controlled
        label="Share with the care team"
        description="Every clinician assigned to this patient can see it."
      />
      <Controlled label="I confirm the patient’s identity" error="Confirm before signing" />
    </div>
  ),
};
