import type { Meta, StoryObj } from '@storybook/react-vite';

import { Alert, type AlertVariant } from '../feedback/Alert';

import { Button } from './Button';

/**
 * DS §8.22: a critical clinical alert can never be dismissed. That rule is
 * the reason this story exists — the `critical` row must render without a
 * close control, and a reviewer should be able to see that at a glance
 * rather than read it in a prop table.
 */

const VARIANTS: readonly AlertVariant[] = ['info', 'success', 'warning', 'error'];

const meta = {
  title: 'Feedback/Alert',
  component: Alert,
  args: { title: 'Result released', children: 'Potassium 6.1 mmol/L — outside the reference range.' },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { variant: 'info' } };

export const EveryVariant: Story = {
  render: (args) => (
    <div className="flex max-w-2xl flex-col gap-3">
      {VARIANTS.map((variant) => (
        <Alert key={variant} {...args} variant={variant} title={`${variant} alert`} />
      ))}
    </div>
  ),
};

export const DismissibleVersusCritical: Story = {
  name: 'Dismissible vs critical (DS §8.22)',
  render: (args) => (
    <div className="flex max-w-2xl flex-col gap-3">
      <Alert {...args} variant="warning" title="Dismissible" onDismiss={() => undefined} />
      <Alert
        {...args}
        variant="error"
        critical
        title="Critical — no dismiss control exists"
        actions={<Button size="sm" variant="destructive">Acknowledge</Button>}
      />
    </div>
  ),
};
