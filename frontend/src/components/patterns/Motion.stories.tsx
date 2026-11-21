import { useState, type ReactNode } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

import { Reveal } from './Reveal';
import { Stagger } from './Stagger';

/**
 * The entrance motion primitives (DS §9). `Reveal` fades one element up
 * after a stagger delay set by its index; `Stagger` does it for a list. Both
 * render their content at rest under reduced motion. "Replay" remounts them.
 */
const meta = { title: 'Patterns/Motion' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Replay({ children }: { children: (key: number) => ReactNode }) {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button size="sm" variant="secondary" onClick={() => setKey((value) => value + 1)}>
          Replay
        </Button>
      </div>
      {children(key)}
    </div>
  );
}

export const RevealSequence: Story = {
  render: () => (
    <Replay>
      {(key) => (
        <div key={key} className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Reveal key={index} index={index}>
              <Card title={`Card ${String(index + 1)}`}>
                <p className="text-body-sm text-text-secondary">Index {index}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      )}
    </Replay>
  ),
};

export const StaggerGrid: Story = {
  render: () => (
    <Replay>
      {(key) => (
        <Stagger
          key={key}
          className="grid gap-4 sm:grid-cols-4"
          items={['Schedule', 'Patients', 'Results', 'Messages'].map((title, index) => ({
            key: title,
            className: index === 0 ? 'sm:col-span-2' : '',
            content: (
              <Card title={title}>
                <p className="text-body-sm text-text-secondary">Item {index + 1}</p>
              </Card>
            ),
          }))}
        />
      )}
    </Replay>
  ),
};
