import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Radio, RadioGroup } from './Radio';

/**
 * DS §8.10. A `radiogroup` fieldset (NEW-19) so `aria-required` and
 * `aria-invalid` sit on a role that allows them; the legend names it.
 */
function Group(props: {
  orientation?: 'vertical' | 'horizontal';
  error?: string;
  disabled?: boolean;
  initial?: string | null;
}) {
  const [value, setValue] = useState<string | null>(props.initial ?? null);
  return (
    <RadioGroup
      label="Severity"
      name="severity"
      value={value}
      onChange={setValue}
      orientation={props.orientation ?? 'vertical'}
      error={props.error}
      disabled={props.disabled ?? false}
      helperText="No default — choosing the severity is the clinician's call."
      required
    >
      <Radio value="mild" label="Mild" />
      <Radio value="moderate" label="Moderate" />
      <Radio value="severe" label="Severe" description="Blocks prescribing in its class." />
    </RadioGroup>
  );
}

const meta = {
  title: 'UI/Radio',
  component: RadioGroup,
  args: { label: 'Severity', name: 'severity', value: null, onChange: () => {}, children: null },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = { render: () => <Group /> };
export const Horizontal: Story = { render: () => <Group orientation="horizontal" /> };
export const WithError: Story = { render: () => <Group error="Choose a severity" /> };
export const Disabled: Story = { render: () => <Group disabled initial="moderate" /> };
