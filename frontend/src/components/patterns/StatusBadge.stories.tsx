import type { Meta, StoryObj } from '@storybook/react-vite';

import { STATUS_PRESENTATION, StatusBadge } from './StatusBadge';

/**
 * The sanctioned status vocabulary, rendered exhaustively.
 *
 * This is the one story that must never be hand-listed: features are
 * forbidden from inventing colour pairings (DS §8.8) precisely because the
 * mapping lives here, so the grid is generated from `STATUS_PRESENTATION`
 * itself. A new status kind appears here the moment it is added, and a
 * reviewer can check the whole vocabulary against both themes in one screen.
 */

const KINDS = Object.keys(STATUS_PRESENTATION) as (keyof typeof STATUS_PRESENTATION)[];

const meta = {
  title: 'Patterns/StatusBadge',
  component: StatusBadge,
  // Required args for the component; the exhaustive grid below overrides
  // them per badge.
  args: { status: 'completed', label: 'Completed' },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryStatusKind: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {KINDS.map((kind) => (
        <StatusBadge key={kind} status={kind} label={kind} />
      ))}
    </div>
  ),
};
