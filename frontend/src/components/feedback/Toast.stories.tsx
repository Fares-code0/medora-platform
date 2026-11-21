import type { Meta, StoryObj } from '@storybook/react-vite';

import { Toast, type ToastVariant } from './Toast';

/**
 * DS §8.23, presentational only. The provider owns the stack, the timers
 * and the announcement (F-18); this renders one toast. It is deliberately
 * not a live region, so nothing here is announced — that is tested against
 * the provider, not in the workbench.
 */
const VARIANTS: readonly ToastVariant[] = ['success', 'info', 'warning', 'error'];

const meta = {
  title: 'Feedback/Toast',
  component: Toast,
  args: {
    toast: {
      id: 't1',
      variant: 'success',
      title: 'Appointment booked',
      description: 'Khaled Mansour · Tue 14 Oct, 09:30',
    },
    onDismiss: () => {},
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};

export const TitleOnly: Story = {
  args: { toast: { id: 't2', variant: 'info', title: 'Draft saved' } },
};

export const WithAction: Story = {
  args: {
    toast: {
      id: 't3',
      variant: 'info',
      title: 'Note archived',
      description: 'It no longer appears on the chart.',
      action: { label: 'Undo', onClick: () => {} },
    },
  },
};

/** A long description wraps; the toast never grows past 360px. */
export const LongCopy: Story = {
  args: {
    toast: {
      id: 't4',
      variant: 'warning',
      title: 'Some results could not be attached',
      description:
        'Two of the five files were larger than the 20 MB limit and were left out. The other three are attached to the visit.',
    },
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {VARIANTS.map((variant) => (
        <Toast
          key={variant}
          toast={{
            id: variant,
            variant,
            title: `${variant[0]?.toUpperCase() ?? ''}${variant.slice(1)} toast`,
            description: 'Supporting description text.',
          }}
          onDismiss={() => {}}
        />
      ))}
    </div>
  ),
};
