import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { Filter } from 'lucide-react';

import { Chip } from './Chip';

/** DS §8.13. Selectable filter chips and removable value chips. */
const meta = {
  title: 'UI/Chip',
  component: Chip,
  args: { label: 'Critical' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Selectable: Story = {
  render: () => {
    function Group() {
      const [on, setOn] = useState<readonly string[]>(['Abnormal']);
      const toggle = (label: string) =>
        setOn((current) =>
          current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
        );
      return (
        <div className="flex gap-2">
          {['Normal', 'Abnormal', 'Critical'].map((label) => (
            <Chip
              key={label}
              label={label}
              icon={Filter}
              selected={on.includes(label)}
              onSelect={() => toggle(label)}
            />
          ))}
        </div>
      );
    }
    return <Group />;
  },
};

export const Removable: Story = {
  render: () => {
    function Values() {
      const [values, setValues] = useState(['Penicillin', 'Latex', 'Peanuts']);
      return (
        <div className="flex gap-2">
          {values.map((value) => (
            <Chip
              key={value}
              label={value}
              removeLabel={`Remove ${value}`}
              onRemove={() => setValues((current) => current.filter((item) => item !== value))}
            />
          ))}
        </div>
      );
    }
    return <Values />;
  },
};

export const Disabled: Story = { args: { disabled: true, selected: true, onSelect: () => {} } };
