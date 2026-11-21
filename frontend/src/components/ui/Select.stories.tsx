import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Select, type SelectOption } from './Select';

/** DS §8.8. A listbox select: placeholder, groups, disabled options, error. */
const OPTIONS: readonly SelectOption[] = [
  { value: 'cardiology', label: 'Cardiology', group: 'Clinical' },
  { value: 'neurology', label: 'Neurology', group: 'Clinical' },
  { value: 'oncology', label: 'Oncology', group: 'Clinical', disabled: true },
  { value: 'admin', label: 'Administration', group: 'Operations' },
];

function Controlled(props: { initial?: string | null; error?: string; disabled?: boolean }) {
  const [value, setValue] = useState<string | null>(props.initial ?? null);
  return (
    <div className="w-72">
      <Select
        label="Department"
        placeholder="Choose a department"
        options={OPTIONS}
        value={value}
        onChange={setValue}
        error={props.error}
        disabled={props.disabled ?? false}
      />
    </div>
  );
}

const meta = {
  title: 'UI/Select',
  component: Select,
  args: { options: OPTIONS, value: null, onChange: () => {} },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placeholder: Story = { render: () => <Controlled /> };
export const Chosen: Story = { render: () => <Controlled initial="neurology" /> };
export const WithError: Story = { render: () => <Controlled error="Choose a department" /> };
export const Disabled: Story = { render: () => <Controlled initial="cardiology" disabled /> };
