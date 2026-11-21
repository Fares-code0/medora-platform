import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './Button';
import { ConfirmationDialog } from './ConfirmationDialog';

/**
 * DS §8.14. A confirmation needs an explicit choice — Escape does not close
 * it; Cancel is the keyboard way out. Destructive and primary tones, and the
 * loading state that keeps the dialog open until the write answers.
 */
function Opener(props: {
  tone: 'destructive' | 'primary';
  loading?: boolean;
  confirmLabel: string;
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <ConfirmationDialog
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}

const meta = {
  title: 'UI/ConfirmationDialog',
  component: ConfirmationDialog,
  args: {
    open: true,
    onClose: () => {},
    onConfirm: () => {},
    title: 'Remove this contact?',
    confirmLabel: 'Remove',
  },
} satisfies Meta<typeof ConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Destructive: Story = {
  render: () => (
    <Opener
      tone="destructive"
      title="Remove this emergency contact?"
      description="The contact is kept in the record's history; it stops being offered."
      confirmLabel="Remove contact"
    />
  ),
};

export const Primary: Story = {
  render: () => (
    <Opener
      tone="primary"
      title="Sign this note?"
      description="Signing freezes the note. Corrections after this are addenda."
      confirmLabel="Sign note"
    />
  ),
};

export const Loading: Story = {
  name: 'Waiting for the write',
  render: () => (
    <Opener
      tone="destructive"
      loading
      title="Cancel this appointment?"
      description="The patient is notified."
      confirmLabel="Cancel appointment"
    />
  ),
};
