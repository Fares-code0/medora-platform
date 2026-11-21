import type { Meta, StoryObj } from '@storybook/react-vite';

import { Textarea } from './Textarea';

/** DS §8.7. Helper text, error, and a character counter that turns red past the limit. */
const meta = {
  title: 'UI/Textarea',
  component: Textarea,
  args: { label: 'Clinical note', placeholder: 'What was found, and what was done' },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHelper: Story = {
  args: { helperText: 'Visible to every clinician on the chart.' },
};
export const WithCount: Story = {
  args: { showCount: true, maxLength: 300, defaultValue: 'Pain improved after the first dose.' },
};
export const OverLimit: Story = {
  name: 'Over the limit (counter in error)',
  args: {
    showCount: true,
    maxLength: 20,
    defaultValue: 'This note is longer than twenty characters.',
  },
};
export const WithError: Story = { args: { error: 'Write the note before saving' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'Signed — read only.' } };
