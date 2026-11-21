import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './Button';
import { Modal } from './Modal';

/**
 * DS §8.14. A native `<dialog>`: focus moves in and returns on close, Escape
 * closes a dismissible modal, `alertdialog` for a decision.
 */
function Opener(props: {
  size: 'sm' | 'md' | 'lg';
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        title="Record vital signs"
        description="All eight readings are required."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save</Button>
          </>
        }
      >
        <p className="text-body-sm text-text-secondary">Modal body.</p>
      </Modal>
    </>
  );
}

const meta = {
  title: 'UI/Modal',
  component: Modal,
  args: { open: true, onClose: () => {}, title: 'Modal', children: null },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = { render: () => <Opener size="sm" /> };
export const Medium: Story = { render: () => <Opener size="md" /> };
export const Large: Story = { render: () => <Opener size="lg" /> };
export const NotDismissible: Story = {
  name: 'Not dismissible (explicit choice)',
  render: () => <Opener size="sm" dismissible={false} role="alertdialog" />,
};
