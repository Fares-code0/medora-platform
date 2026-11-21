import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './Button';
import { Drawer } from './Drawer';

/** DS §8.15. Side panel with focus trap, Escape to close, and a sticky footer. */
function Opener({ size }: { size: 'sm' | 'md' | 'lg' }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open drawer</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`Filters (${size})`}
        size={size}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Clear
            </Button>
            <Button onClick={() => setOpen(false)}>Apply</Button>
          </>
        }
      >
        <p className="text-body-sm text-text-secondary">Drawer content scrolls under the footer.</p>
      </Drawer>
    </>
  );
}

const meta = {
  title: 'UI/Drawer',
  component: Drawer,
  args: { open: true, onClose: () => {}, title: 'Filters', children: null },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = { render: () => <Opener size="sm" /> };
export const Medium: Story = { render: () => <Opener size="md" /> };
export const Large: Story = { render: () => <Opener size="lg" /> };
