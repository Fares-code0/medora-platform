import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { TagListField } from './TagListField';

/** A free-text list field — allergies, languages, qualifications. */
function Controlled(props: { initial: readonly string[]; error?: string; wide?: boolean }) {
  const [value, setValue] = useState<readonly string[]>(props.initial);
  return (
    <TagListField
      label="Allergies"
      placeholder="Add an allergy and press Enter"
      value={value}
      onChange={setValue}
      error={props.error}
      wide={props.wide ?? false}
    />
  );
}

const meta = {
  title: 'Patterns/TagListField',
  component: TagListField,
  args: {
    label: 'Allergies',
    placeholder: 'Add an allergy and press Enter',
    value: ['Penicillin', 'Latex'],
    onChange: () => {},
  },
} satisfies Meta<typeof TagListField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTags: Story = { render: () => <Controlled initial={['Penicillin', 'Latex']} /> };

export const Empty: Story = { render: () => <Controlled initial={[]} /> };

export const WithError: Story = {
  render: () => <Controlled initial={[]} error="Record at least one, or “None known”" />,
};

export const Wide: Story = {
  render: () => <Controlled initial={['Penicillin', 'Latex', 'Shellfish', 'Aspirin']} wide />,
};
