import type { Meta, StoryObj } from '@storybook/react-vite';

import { PasswordStrengthMeter } from './PasswordStrengthMeter';

/**
 * The strength meter under a new-password field. Its label is the signal —
 * the bars are `aria-hidden` and their colour only repeats the word — and it
 * renders nothing while the field is empty.
 */
const meta = {
  title: 'Patterns/PasswordStrengthMeter',
  component: PasswordStrengthMeter,
  args: { password: 'Medora2026!' },
} satisfies Meta<typeof PasswordStrengthMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Strong: Story = {};

export const EveryTier: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      {['a', 'abcdefgh', 'abcdefgh1', 'Abcdefgh1', 'Abcdefgh1!xyz'].map((password) => (
        <div key={password}>
          <code className="font-mono text-caption text-text-secondary">{password}</code>
          <PasswordStrengthMeter password={password} />
        </div>
      ))}
    </div>
  ),
};

export const Empty: Story = { args: { password: '' } };
