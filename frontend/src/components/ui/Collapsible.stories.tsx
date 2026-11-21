import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Collapsible } from './Collapsible';

/**
 * A disclosure section. Closed content is `visibility: hidden`, so nothing
 * inside it takes focus (DX-05), and the in-app reduce-motion setting wins
 * over the OS one.
 */
function Controlled({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <Collapsible
      id="analytics"
      title="Analytics"
      caption="Last 30 days"
      summary="Pulse, trend and satisfaction"
      open={open}
      onOpenChange={setOpen}
    >
      <p className="text-body-sm text-text-secondary">
        Practice pulse, appointments trend and patient satisfaction.
      </p>
    </Collapsible>
  );
}

const meta = {
  title: 'UI/Collapsible',
  component: Collapsible,
  args: {
    id: 'analytics',
    title: 'Analytics',
    open: false,
    onOpenChange: () => {},
    children: null,
  },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = { render: () => <Controlled initiallyOpen={false} /> };
export const Open: Story = { render: () => <Controlled initiallyOpen /> };
