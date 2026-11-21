import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, Pencil, Trash2 } from 'lucide-react';

import { ContextMenu } from './ContextMenu';

/** Right-click (or Shift+F10) menu over a region; the full WAI-ARIA menu pattern. */
const meta = {
  title: 'UI/ContextMenu',
  component: ContextMenu,
  args: {
    menuLabel: 'Row actions',
    entries: [
      { id: 'edit', label: 'Edit', icon: Pencil, onSelect: () => {} },
      { id: 'copy', label: 'Copy ID', icon: Copy, onSelect: () => {} },
      { type: 'separator', id: 'sep' },
      { id: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => {} },
      { id: 'disabled', label: 'Archive (not allowed)', disabled: true, onSelect: () => {} },
    ],
    children: (
      <div className="rounded-surface border border-dashed border-border p-8 text-center text-body-sm text-text-secondary">
        Right-click here
      </div>
    ),
  },
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
