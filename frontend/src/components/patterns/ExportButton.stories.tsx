import type { Meta, StoryObj } from '@storybook/react-vite';

import { ExportButton } from './ExportButton';

/**
 * The export menu (CSV, JSON, PDF/print). The dataset is read when a format
 * is chosen, not when the button renders, so it always exports what the
 * table shows at that moment. Choosing a format here downloads a file.
 */
const meta = {
  title: 'Patterns/ExportButton',
  component: ExportButton,
  args: {
    getDataset: () => ({
      filename: 'medora-appointments',
      title: 'Appointments',
      columns: ['Time', 'Patient', 'Type'],
      rows: [
        ['09:00', 'Khaled Mansour', 'Follow-up'],
        ['09:30', 'Layla Haddad', 'New patient'],
      ],
    }),
  },
} satisfies Meta<typeof ExportButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { size: 'sm', label: 'Export list' } };

export const Disabled: Story = { args: { disabled: true } };
