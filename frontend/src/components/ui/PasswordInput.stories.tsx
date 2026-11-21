import type { Meta, StoryObj } from '@storybook/react-vite';

import { PasswordInput } from './PasswordInput';

/** Show/hide is a 24px in-field toggle (44px on touch, DEC-008) with `aria-pressed`. */
const meta = {
  title: 'UI/PasswordInput',
  component: PasswordInput,
  args: { label: 'Password' },
} satisfies Meta<typeof PasswordInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHelper: Story = { args: { helperText: 'At least 12 characters.' } };
export const WithError: Story = { args: { error: 'Enter your password', defaultValue: '' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'secret-value' } };
