import type { Meta, StoryObj } from '@storybook/react-vite';

import { CircularProgress, Progress } from './Progress';

/**
 * DS §8.24. Linear (8px, 4px slim) and circular (16 / 24 / 48), determinate
 * and indeterminate. Every bar carries an accessible name — the visible
 * label when there is one, `aria-label` otherwise — and the indeterminate
 * variant omits `aria-valuenow`, which is how a reader is told "busy".
 */
const meta = {
  title: 'Feedback/Progress',
  component: Progress,
  args: { value: 64, label: 'Uploading scan', showValue: true },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Determinate: Story = {};

export const Slim: Story = { args: { slim: true } };

export const Indeterminate: Story = {
  args: { value: undefined, label: 'Preparing export', showValue: false },
};

export const UnlabelledBar: Story = {
  args: { label: undefined, showValue: false, 'aria-label': 'Profile completion' },
};

/** Out-of-range values clamp: 0, a midpoint, 100, and beyond. */
export const Range: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      {[0, 35, 100, 140].map((value) => (
        <Progress key={value} value={value} label={`Value ${String(value)}`} showValue />
      ))}
    </div>
  ),
};

export const Circular: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <CircularProgress size={16} value={25} aria-label="Upload 25%" />
      <CircularProgress size={24} value={60} aria-label="Upload 60%" />
      <CircularProgress size={48} value={90} aria-label="Upload 90%" />
      <CircularProgress size={24} aria-label="Summarising the record" />
      <CircularProgress size={48} aria-label="Transcribing" />
    </div>
  ),
};
